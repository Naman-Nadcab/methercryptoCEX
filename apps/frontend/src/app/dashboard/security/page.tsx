'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/toaster';
import Link from 'next/link';
import {
  Lock,
  Mail,
  Smartphone,
  Shield,
  KeyRound,
  ShieldCheck,
  BookOpen,
  MapPin,
  Coins,
  X,
  ChevronDown,
  Loader2,
  Check,
  AlertTriangle,
  Eye,
  EyeOff,
  Copy,
  Fingerprint,
  BadgeCheck,
  Monitor,
} from 'lucide-react';
import { 
  createPasskey,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
  getDeviceName as getDeviceNameLib,
} from '@/lib/webauthn';

// Country codes with flags
const countries = [
  { code: '+91', name: 'India', flag: '🇮🇳' },
  { code: '+1', name: 'United States', flag: '🇺🇸' },
  { code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { code: '+971', name: 'UAE', flag: '🇦🇪' },
  { code: '+65', name: 'Singapore', flag: '🇸🇬' },
  { code: '+61', name: 'Australia', flag: '🇦🇺' },
  { code: '+49', name: 'Germany', flag: '🇩🇪' },
  { code: '+33', name: 'France', flag: '🇫🇷' },
  { code: '+81', name: 'Japan', flag: '🇯🇵' },
  { code: '+86', name: 'China', flag: '🇨🇳' },
];

// Modal Component - defined outside to prevent re-creation on every render
const Modal = ({ show, onClose, title, children }: { 
  show: boolean; 
  onClose: () => void; 
  title: string;
  children: React.ReactNode;
}) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div 
        className="relative bg-card rounded-xl w-full max-w-md shadow-2xl z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-xl transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

type SecurityStatusTone = 'enabled' | 'recommended' | 'neutral';

const statusDotClass: Record<SecurityStatusTone, string> = {
  enabled: 'bg-buy',
  recommended: 'bg-primary',
  neutral: 'bg-muted-foreground',
};

const statusTextClass: Record<SecurityStatusTone, string> = {
  enabled: 'text-buy',
  recommended: 'text-primary',
  neutral: 'text-muted-foreground',
};

/** Feature card: icon, title, description, status dot + label, actions */
const SecurityFeatureCard = ({
  icon: Icon,
  title,
  description,
  status,
  statusTone = 'neutral',
  statusValue,
  loading,
  actionLabel,
  actionVariant = 'default',
  onAction,
  actionDisabled,
  secondaryAction,
  secondaryLabel,
  toggleEnabled,
  onToggle,
  toggleLoading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string | React.ReactNode;
  status?: string;
  statusTone?: SecurityStatusTone;
  statusValue?: string;
  loading?: boolean;
  actionLabel?: string;
  actionVariant?: 'default' | 'primary' | 'danger';
  onAction?: () => void;
  actionDisabled?: boolean;
  secondaryAction?: () => void;
  secondaryLabel?: string;
  toggleEnabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  toggleLoading?: boolean;
}) => (
  <div className="flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
    <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="font-semibold text-foreground">{title}</h3>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
        {status && (
          <p className={`inline-flex items-center gap-2 text-sm font-medium ${statusTextClass[statusTone]}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass[statusTone]}`} />
            {statusValue || status}
          </p>
        )}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          {onToggle && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!toggleLoading) onToggle(!toggleEnabled);
              }}
              disabled={toggleLoading}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ${
                toggleEnabled ? 'bg-buy' : 'bg-muted'
              } ${toggleLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              {toggleLoading ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
                </span>
              ) : (
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ${
                    toggleEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              )}
            </button>
          )}
          {secondaryAction && secondaryLabel && (
            <button
              type="button"
              onClick={secondaryAction}
              className="rounded-xl bg-muted px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
            >
              {secondaryLabel}
            </button>
          )}
          {actionLabel && (
            <button
              type="button"
              onClick={onAction}
              disabled={Boolean(actionDisabled || !onAction)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
                actionVariant === 'primary'
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground'
                  : actionVariant === 'danger'
                    ? 'bg-sell text-primary-foreground shadow-sm hover:bg-sell/90 disabled:bg-muted disabled:text-muted-foreground'
                    : 'bg-muted text-foreground hover:bg-muted/80 disabled:bg-muted disabled:text-muted-foreground'
              }`}
            >
              {actionLabel}
            </button>
          )}
        </>
      )}
    </div>
  </div>
);

const ToggleSwitch = ({ enabled, onChange, loading }: { enabled: boolean; onChange: () => void; loading?: boolean }) => {
  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative h-8 w-14 rounded-full transition-colors ${enabled ? 'bg-buy' : 'bg-muted'}`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full bg-card shadow transition-all ${enabled ? 'right-1' : 'left-1'}`}
      />
    </button>
  );
};

export default function SecurityPage() {
  const router = useRouter();
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const [withdrawalWhitelist, setWithdrawalWhitelist] = useState(false);
  const [withdrawViaAddressBook, setWithdrawViaAddressBook] = useState(false);
  const [newAddressLock, setNewAddressLock] = useState(false);
  const [loadingWhitelist, setLoadingWhitelist] = useState(true);
  const [togglingWhitelist, setTogglingWhitelist] = useState(false);

  // Withdraw via Address Book Modal States
  const [showAddressBookModal, setShowAddressBookModal] = useState(false);
  const [loadingAddressBook, setLoadingAddressBook] = useState(true);
  const [enablingAddressBook, setEnablingAddressBook] = useState(false);
  
  // SMS / phone verification flow
  const [showPhoneInputModal, setShowPhoneInputModal] = useState(false);
  const [showPhoneOtpModal, setShowPhoneOtpModal] = useState(false);

  const [phoneOtp, setPhoneOtp] = useState(['', '', '', '', '', '']);
  const [selectedCountry, setSelectedCountry] = useState(countries[0]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);

  const [sendingPhoneOtp, setSendingPhoneOtp] = useState(false);
  const [verifyingPhoneOtp, setVerifyingPhoneOtp] = useState(false);
  const [phoneOtpTimer, setPhoneOtpTimer] = useState(0);
  
  // User phone status
  const [userPhone, setUserPhone] = useState<string | null>(null);
  const [loadingPhone, setLoadingPhone] = useState(true);
  const [smsAuthEnabled, setSmsAuthEnabled] = useState(false);
  const [togglingSmsAuth, setTogglingSmsAuth] = useState(false);

  // Email Change States
  const [showEmailChangeModal, setShowEmailChangeModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailChangeOtp, setEmailChangeOtp] = useState(['', '', '', '', '', '']);
  const [emailChangeStep, setEmailChangeStep] = useState<'input' | 'verify'>('input');
  const [sendingEmailChangeOtp, setSendingEmailChangeOtp] = useState(false);
  const [verifyingEmailChange, setVerifyingEmailChange] = useState(false);
  const [emailChangeOtpTimer, setEmailChangeOtpTimer] = useState(0);
  const emailChangeOtpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // SMS Change States (for changing existing phone)
  const [showSmsChangeModal, setShowSmsChangeModal] = useState(false);
  const [smsChangeStep, setSmsChangeStep] = useState<'verify_current' | 'input_new' | 'verify_new'>('verify_current');
  const [currentPhoneOtp, setCurrentPhoneOtp] = useState(['', '', '', '', '', '']);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newPhoneOtp, setNewPhoneOtp] = useState(['', '', '', '', '', '']);
  const [sendingSmsChangeOtp, setSendingSmsChangeOtp] = useState(false);
  const [verifyingSmsChange, setVerifyingSmsChange] = useState(false);
  const [smsChangeOtpTimer, setSmsChangeOtpTimer] = useState(0);
  const currentPhoneOtpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const newPhoneOtpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Password Change States
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Google 2FA States
  const [showGoogle2faEmailOtpModal, setShowGoogle2faEmailOtpModal] = useState(false);
  const [showGoogle2faSetupModal, setShowGoogle2faSetupModal] = useState(false);
  const [google2faSecret, setGoogle2faSecret] = useState('');
  const [google2faQrCode, setGoogle2faQrCode] = useState('');
  const [google2faCode, setGoogle2faCode] = useState('');
  const [google2faEmailOtp, setGoogle2faEmailOtp] = useState(['', '', '', '', '', '']);
  const [google2faEmailOtpTimer, setGoogle2faEmailOtpTimer] = useState(0);
  const [sendingGoogle2faEmailOtp, setSendingGoogle2faEmailOtp] = useState(false);
  const [verifyingGoogle2faEmailOtp, setVerifyingGoogle2faEmailOtp] = useState(false);
  const [enablingGoogle2fa, setEnablingGoogle2fa] = useState(false);
  const [user2faEnabled, setUser2faEnabled] = useState(false);
  const [loadingGoogle2fa, setLoadingGoogle2fa] = useState(true);
  const google2faEmailOtpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Disable 2FA States
  const [showDisable2faConfirmModal, setShowDisable2faConfirmModal] = useState(false);
  const [showDisable2faVerifyModal, setShowDisable2faVerifyModal] = useState(false);
  const [disable2faPassword, setDisable2faPassword] = useState('');
  const [disable2faCode, setDisable2faCode] = useState('');
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disabling2fa, setDisabling2fa] = useState(false);

  // Passkeys State
  const [passkeysCount, setPasskeysCount] = useState(0);
  const [loadingPasskeys, setLoadingPasskeys] = useState(true);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [passkeys, setPasskeys] = useState<Array<{ id: string; device_name: string; created_at: string; last_used_at: string | null }>>([]);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);

  // Fund Password States
  const [hasFundPassword, setHasFundPassword] = useState(false);
  const [loadingFundPassword, setLoadingFundPassword] = useState(true);

  // Anti-Phishing Code States (summary on hub; edit on /dashboard/security/anti-phishing)
  const [antiPhishingCode, setAntiPhishingCode] = useState('');
  const [loadingAntiPhishing, setLoadingAntiPhishing] = useState(true);

  const [securityTab, setSecurityTab] = useState<
    'all' | 'login' | 'twoFactor' | 'advanced' | 'withdrawal'
  >('all');

  const apiUrl = getApiBaseUrl();
  
  const phoneOtpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Calculate security level
  const calculateSecurityLevel = () => {
    let score = 0;
    if (user?.email) score += 20;
    if (userPhone) score += 20;
    if (user2faEnabled) score += 30;
    if (passkeysCount > 0) score += 15;
    if (hasFundPassword) score += 15;
    return score;
  };

  const securityLevel = calculateSecurityLevel();
  const securityStatus = securityLevel >= 80 ? 'High' : securityLevel >= 50 ? 'Medium' : 'Low';
  const securityColor =
    securityLevel >= 80 ? 'text-buy' : securityLevel >= 50 ? 'text-primary' : 'text-sell';
  const securityIconBg =
    securityLevel >= 80 ? 'bg-buy' : securityLevel >= 50 ? 'bg-primary' : 'bg-muted';
  const securityIconColor =
    securityLevel >= 80 || securityLevel >= 50 ? 'text-primary-foreground' : 'text-sell';
  const securityProgressClass =
    securityLevel >= 80 ? 'bg-buy' : securityLevel >= 50 ? 'bg-primary' : 'bg-sell';

  // Fetch user phone, 2FA status, and passkeys
  useEffect(() => {
    const fetchUserData = async () => {
      if (!_hasHydrated || !accessToken) return;
      try {
        // Fetch profile
        const response = await fetch(`${apiUrl}/api/v1/auth/profile`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await response.json();
        if (result.success) {
          if (result.data.user?.phone) {
            setUserPhone(result.data.user.phone);
          }
          setUser2faEnabled(result.data.user?.totp_enabled || false);
        }

        // Fetch SMS auth status
        const smsAuthResult = await api.get<{ enabled: boolean }>('/api/v1/auth/sms-auth/status', {
          notifyOnError: false,
        });
        if (smsAuthResult.success && smsAuthResult.data) {
          setSmsAuthEnabled(smsAuthResult.data.enabled || false);
        }

        // Fetch passkeys count
        const passkeysRes = await fetch(`${apiUrl}/api/v1/auth/passkeys`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const passkeysResult = await passkeysRes.json();
        if (passkeysResult.success) {
          setPasskeysCount(passkeysResult.data.passkeys?.length || 0);
        }

        // Fetch fund password status
        const fundPwRes = await fetch(`${apiUrl}/api/v1/auth/fund-password/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const fundPwResult = await fundPwRes.json();
        if (fundPwResult.success) {
          setHasFundPassword(fundPwResult.data.hasFundPassword || false);
        }

        // Fetch anti-phishing code
        const antiPhishRes = await fetch(`${apiUrl}/api/v1/auth/anti-phishing/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const antiPhishResult = await antiPhishRes.json();
        if (antiPhishResult.success) {
          setAntiPhishingCode(antiPhishResult.data.code || '');
        }

        // Fetch withdrawal whitelist status
        const whitelistResult = await api.get<{ enabled: boolean }>('/api/v1/auth/withdrawal-whitelist/status', {
          notifyOnError: false,
        });
        if (whitelistResult.success && whitelistResult.data) {
          setWithdrawalWhitelist(whitelistResult.data.enabled || false);
        }

        // Fetch address book status
        const addressBookRes = await fetch(`${apiUrl}/api/v1/auth/address-book/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const addressBookResult = await addressBookRes.json();
        if (addressBookResult.success) {
          setWithdrawViaAddressBook(addressBookResult.data.enabled || false);
        }
      } catch (error) {
        console.error('Failed to fetch user data:', error);
      } finally {
        setLoadingPhone(false);
        setLoadingGoogle2fa(false);
        setLoadingPasskeys(false);
        setLoadingFundPassword(false);
        setLoadingAntiPhishing(false);
        setLoadingWhitelist(false);
        setLoadingAddressBook(false);
      }
    };
    fetchUserData();
  }, [accessToken, _hasHydrated]);

  useEffect(() => {
    if (phoneOtpTimer > 0) {
      const timer = setTimeout(() => setPhoneOtpTimer(phoneOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [phoneOtpTimer]);

  useEffect(() => {
    if (google2faEmailOtpTimer > 0) {
      const timer = setTimeout(() => setGoogle2faEmailOtpTimer(google2faEmailOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [google2faEmailOtpTimer]);

  useEffect(() => {
    if (emailChangeOtpTimer > 0) {
      const timer = setTimeout(() => setEmailChangeOtpTimer(emailChangeOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [emailChangeOtpTimer]);

  useEffect(() => {
    if (smsChangeOtpTimer > 0) {
      const timer = setTimeout(() => setSmsChangeOtpTimer(smsChangeOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [smsChangeOtpTimer]);

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '***';
    return `${maskedLocal}@${domain}`;
  };

  const maskPhone = (phone: string) => {
    if (!phone) return '';
    return phone.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2');
  };

  // SMS Auth Toggle
  const toggleSmsAuth = async (enabled: boolean) => {
    if (!userPhone) {
      toast({ title: 'Validation', description: 'Please add a phone number first', variant: 'destructive' });
      return;
    }
    setTogglingSmsAuth(true);
    try {
      const result = await api.post<{ enabled?: boolean }>('/api/v1/auth/sms-auth/toggle', { enabled }, { notifyOnError: false });
      if (result.success) {
        setSmsAuthEnabled(typeof result.data?.enabled === 'boolean' ? result.data.enabled : enabled);
      } else {
        toast({
          title: 'Error',
          description: result.error?.message || 'Failed to update SMS authentication',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to toggle SMS auth:', error);
      toast({ title: 'Error', description: 'Failed to update SMS authentication', variant: 'destructive' });
    } finally {
      setTogglingSmsAuth(false);
    }
  };

  /** Add phone: enter number → SMS OTP via send-security-otp → verify-phone-setup → enable SMS auth */
  const handleSmsSettingsClick = () => {
    setPhoneOtp(['', '', '', '', '', '']);
    setShowPhoneInputModal(true);
  };

  const handlePhoneSubmit = () => {
    if (phoneNumber.length < 10) {
      toast({ title: 'Validation', description: 'Please enter a valid phone number', variant: 'destructive' });
      return;
    }
    setShowPhoneInputModal(false);
    setShowPhoneOtpModal(true);
    setPhoneOtp(['', '', '', '', '', '']);
    void sendPhoneOtp();
  };

  const sendPhoneOtp = async () => {
    if (sendingPhoneOtp || phoneOtpTimer > 0) return;
    setSendingPhoneOtp(true);
    try {
      const fullPhone = selectedCountry.code + phoneNumber;
      const result = await api.post('/api/v1/auth/send-security-otp', {
        channel: 'sms',
        phone: fullPhone,
        purpose: 'sms_setup',
      }, { notifyOnError: false });
      if (result.success) {
        setPhoneOtpTimer(60);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send phone OTP:', error);
      toast({ title: 'Error', description: 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setSendingPhoneOtp(false);
    }
  };

  const verifyPhoneOtp = async () => {
    const code = phoneOtp.join('');
    if (code.length !== 6) return;

    setVerifyingPhoneOtp(true);
    try {
      const fullPhone = selectedCountry.code + phoneNumber;
      const result = await api.post('/api/v1/auth/verify-phone-setup', { phone: fullPhone, code }, { notifyOnError: false });
      if (result.success) {
        setUserPhone(fullPhone);
        setShowPhoneOtpModal(false);
        setPhoneOtp(['', '', '', '', '', '']);
        setPhoneNumber('');

        const toggleRes = await api.post<{ enabled?: boolean }>(
          '/api/v1/auth/sms-auth/toggle',
          { enabled: true },
          { notifyOnError: false }
        );
        if (toggleRes.success) {
          setSmsAuthEnabled(true);
          toast({
            title: 'Success',
            description: 'Phone verified and SMS authentication enabled.',
            variant: 'success',
          });
        } else {
          toast({
            title: 'Phone verified',
            description:
              toggleRes.error?.message ||
              'Your phone is saved. Turn on SMS authentication using the toggle if it did not enable automatically.',
            variant: 'success',
          });
        }
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Invalid code', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to verify phone OTP:', error);
      toast({ title: 'Error', description: 'Failed to verify OTP', variant: 'destructive' });
    } finally {
      setVerifyingPhoneOtp(false);
    }
  };

  // Google 2FA Functions
  const handleGoogle2faSettingsClick = () => {
    setShowGoogle2faEmailOtpModal(true);
    sendGoogle2faEmailOtp();
  };

  const sendGoogle2faEmailOtp = async () => {
    if (sendingGoogle2faEmailOtp || google2faEmailOtpTimer > 0) return;
    setSendingGoogle2faEmailOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', purpose: '2fa_setup' }),
      });
      const result = await response.json();
      if (result.success) {
        setGoogle2faEmailOtpTimer(60);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send email OTP:', error);
      toast({ title: 'Error', description: 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setSendingGoogle2faEmailOtp(false);
    }
  };

  const verifyGoogle2faEmailOtp = async () => {
    const otp = google2faEmailOtp.join('');
    if (otp.length !== 6) return;
    
    setVerifyingGoogle2faEmailOtp(true);
    try {
      const verifyResponse = await fetch(`${apiUrl}/api/v1/auth/verify-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', otp, purpose: '2fa_setup' }),
      });
      const verifyResult = await verifyResponse.json();
      
      if (!verifyResult.success) {
        toast({ title: 'Error', description: verifyResult.error?.message || 'Invalid OTP', variant: 'destructive' });
        return;
      }

      const setupResponse = await fetch(`${apiUrl}/api/v1/auth/2fa/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
      const setupResult = await setupResponse.json();
      
      if (setupResult.success) {
        setGoogle2faSecret(setupResult.data.secret);
        setGoogle2faQrCode(setupResult.data.qrCode);
        setShowGoogle2faEmailOtpModal(false);
        setShowGoogle2faSetupModal(true);
        setGoogle2faEmailOtp(['', '', '', '', '', '']);
      } else {
        toast({ title: 'Error', description: setupResult.error?.message || 'Failed to setup 2FA', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to verify email OTP:', error);
      toast({ title: 'Error', description: 'Failed to verify OTP', variant: 'destructive' });
    } finally {
      setVerifyingGoogle2faEmailOtp(false);
    }
  };

  const enableGoogle2fa = async () => {
    if (!google2faCode || google2faCode.length !== 6) {
      toast({ title: 'Validation', description: 'Please enter a valid 6-digit code', variant: 'destructive' });
      return;
    }

    setEnablingGoogle2fa(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/2fa/enable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ code: google2faCode, secret: google2faSecret }),
      });
      const result = await response.json();
      
      if (result.success) {
        setUser2faEnabled(true);
        setShowGoogle2faSetupModal(false);
        setGoogle2faCode('');
        setGoogle2faSecret('');
        setGoogle2faQrCode('');
        toast({ title: 'Success', description: 'Google 2FA enabled successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Invalid code. Please try again.', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to enable 2FA:', error);
      toast({ title: 'Error', description: 'Failed to enable 2FA', variant: 'destructive' });
    } finally {
      setEnablingGoogle2fa(false);
    }
  };

  const handleDisable2faClick = () => {
    setShowDisable2faConfirmModal(true);
  };

  const confirmDisable2fa = () => {
    setShowDisable2faConfirmModal(false);
    setShowDisable2faVerifyModal(true);
  };

  const disableGoogle2fa = async () => {
    if (!disable2faPassword || !disable2faCode) {
      toast({ title: 'Validation', description: 'Please enter both password and 2FA code', variant: 'destructive' });
      return;
    }

    setDisabling2fa(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/2fa/disable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password: disable2faPassword, code: disable2faCode }),
      });
      const result = await response.json();
      
      if (result.success) {
        setUser2faEnabled(false);
        setShowDisable2faVerifyModal(false);
        setDisable2faPassword('');
        setDisable2faCode('');
        toast({ title: 'Success', description: 'Google 2FA disabled successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to disable 2FA', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to disable 2FA:', error);
      toast({ title: 'Error', description: 'Failed to disable 2FA', variant: 'destructive' });
    } finally {
      setDisabling2fa(false);
    }
  };

  // Passkey Functions
  const handlePasskeySettingsClick = async () => {
    setShowPasskeyModal(true);
    await fetchPasskeys();
  };

  const fetchPasskeys = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/passkeys`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setPasskeys(result.data.passkeys || []);
        setPasskeysCount(result.data.passkeys?.length || 0);
      }
    } catch (error) {
      console.error('Failed to fetch passkeys:', error);
    }
  };
  const registerPasskey = async () => {
    setRegisteringPasskey(true);
    try {
      // Check WebAuthn support
      if (!isWebAuthnSupported()) {
        toast({ title: 'Not supported', description: 'WebAuthn is not supported in this browser. Please use Chrome or Safari.', variant: 'destructive' });
        setRegisteringPasskey(false);
        return;
      }
      
      // Check platform authenticator availability
      const platformAvailable = await isPlatformAuthenticatorAvailable();
      if (!platformAvailable) {
        toast({ title: 'Not available', description: 'Touch ID / Face ID is not available on this device. Please enable biometric authentication in System Settings.', variant: 'destructive' });
        setRegisteringPasskey(false);
        return;
      }

      // Auto-detect device name
      const deviceName = getDeviceNameLib();

      // Step 1: Get registration options from server
      const optionsResponse = await fetch(`${apiUrl}/api/v1/auth/passkey/register/options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
      
      if (optionsResponse.status === 401) {
        toast({ title: 'Session expired', description: 'Please log out and log in again.', variant: 'destructive' });
        setRegisteringPasskey(false);
        return;
      }
      
      const optionsData = await optionsResponse.json();

      if (!optionsData.success) {
        toast({ title: 'Error', description: optionsData.error?.message || 'Failed to start passkey registration', variant: 'destructive' });
        setRegisteringPasskey(false);
        return;
      }

      console.log('[Passkey] Registration options received from server');

      // Step 2: Create passkey using NATIVE WebAuthn API
      // This forces platform authenticator (Touch ID / Face ID)
      const result = await createPasskey(optionsData.data);

      if (!result.success) {
        toast({ title: 'Error', description: result.error?.message || 'Failed to create passkey', variant: 'destructive' });
        setRegisteringPasskey(false);
        return;
      }

      console.log('[Passkey] Credential created, verifying with server');

      // Step 3: Verify the registration with the server
      const verifyResponse = await fetch(`${apiUrl}/api/v1/auth/passkey/register/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          credential: result.credential,
          deviceName,
        }),
      });

      const verifyData = await verifyResponse.json();

      if (verifyData.success) {
        toast({ title: 'Success', description: 'Passkey registered. You can now login with Touch ID / Face ID.', variant: 'success' });
        await fetchPasskeys();
        setShowPasskeyModal(false);
      } else {
        toast({ title: 'Error', description: verifyData.error?.message || 'Failed to register passkey', variant: 'destructive' });
      }
    } catch (err: unknown) {
      console.error('[Passkey] Unexpected registration error:', err);
      toast({ title: 'Error', description: 'An unexpected error occurred. Please try again.', variant: 'destructive' });
    } finally {
      setRegisteringPasskey(false);
    }
  };

  const deletePasskey = async (passkeyId: string) => {
    if (!confirm('Are you sure you want to delete this passkey?')) {
      return;
    }

    setDeletingPasskeyId(passkeyId);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/passkeys/${passkeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();

      if (result.success) {
        await fetchPasskeys();
        toast({ title: 'Success', description: 'Passkey deleted successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to delete passkey', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to delete passkey:', error);
      toast({ title: 'Error', description: 'Failed to delete passkey', variant: 'destructive' });
    } finally {
      setDeletingPasskeyId(null);
    }
  };

  const handleFundPasswordClick = () => {
    router.push('/dashboard/security/fund-password');
  };

  const handleAntiPhishingClick = () => {
    router.push('/dashboard/security/anti-phishing');
  };

  // Email Change Functions
  const handleEmailChangeClick = () => {
    setNewEmail('');
    setEmailChangeOtp(['', '', '', '', '', '']);
    setEmailChangeStep('input');
    setShowEmailChangeModal(true);
  };

  const sendEmailChangeOtp = async () => {
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast({ title: 'Validation', description: 'Please enter a valid email address', variant: 'destructive' });
      return;
    }
    setSendingEmailChangeOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ identifier: newEmail, type: 'email', purpose: 'email_change' }),
      });
      const result = await response.json();
      if (result.success) {
        setEmailChangeStep('verify');
        setEmailChangeOtpTimer(60);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send email OTP:', error);
      toast({ title: 'Error', description: 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setSendingEmailChangeOtp(false);
    }
  };

  const verifyEmailChange = async () => {
    const otp = emailChangeOtp.join('');
    if (otp.length !== 6) {
      toast({ title: 'Validation', description: 'Please enter a valid 6-digit code', variant: 'destructive' });
      return;
    }
    setVerifyingEmailChange(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/change-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ newEmail, otp }),
      });
      const result = await response.json();
      if (result.success) {
        setShowEmailChangeModal(false);
        toast({ title: 'Success', description: 'Email changed. Please re-login.', variant: 'success' });
        router.push('/login');
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to change email', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to change email:', error);
      toast({ title: 'Error', description: 'Failed to change email', variant: 'destructive' });
    } finally {
      setVerifyingEmailChange(false);
    }
  };

  // SMS Change Functions (for changing existing phone)
  const handleSmsChangeClick = () => {
    setCurrentPhoneOtp(['', '', '', '', '', '']);
    setNewPhoneNumber('');
    setNewPhoneOtp(['', '', '', '', '', '']);
    setSmsChangeStep('verify_current');
    setShowSmsChangeModal(true);
    sendCurrentPhoneOtp();
  };

  const sendCurrentPhoneOtp = async () => {
    setSendingSmsChangeOtp(true);
    try {
      const result = await api.post(
        '/api/v1/auth/send-security-otp',
        { channel: 'sms', purpose: 'phone_change' },
        { notifyOnError: false }
      );
      if (result.success) {
        setSmsChangeOtpTimer(60);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send phone OTP:', error);
      toast({ title: 'Error', description: 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setSendingSmsChangeOtp(false);
    }
  };

  const verifyCurrentPhoneAndContinue = async () => {
    const code = currentPhoneOtp.join('');
    if (code.length !== 6) {
      toast({ title: 'Validation', description: 'Please enter a valid 6-digit code', variant: 'destructive' });
      return;
    }
    setVerifyingSmsChange(true);
    try {
      const result = await api.post(
        '/api/v1/auth/verify-security-otp',
        { channel: 'sms', code, purpose: 'phone_change' },
        { notifyOnError: false }
      );
      if (result.success) {
        setSmsChangeStep('input_new');
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Invalid OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to verify OTP:', error);
      toast({ title: 'Error', description: 'Failed to verify OTP', variant: 'destructive' });
    } finally {
      setVerifyingSmsChange(false);
    }
  };

  const sendNewPhoneOtp = async () => {
    if (!newPhoneNumber || newPhoneNumber.length < 10) {
      toast({ title: 'Validation', description: 'Please enter a valid phone number', variant: 'destructive' });
      return;
    }
    const fullPhone = selectedCountry?.code + newPhoneNumber;
    setSendingSmsChangeOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ identifier: fullPhone, type: 'phone', purpose: 'phone_change_new' }),
      });
      const result = await response.json();
      if (result.success) {
        setSmsChangeStep('verify_new');
        setSmsChangeOtpTimer(60);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send phone OTP:', error);
      toast({ title: 'Error', description: 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setSendingSmsChangeOtp(false);
    }
  };

  const verifyNewPhoneAndSave = async () => {
    const otp = newPhoneOtp.join('');
    if (otp.length !== 6) {
      toast({ title: 'Validation', description: 'Please enter a valid 6-digit code', variant: 'destructive' });
      return;
    }
    const fullPhone = selectedCountry?.code + newPhoneNumber;
    setVerifyingSmsChange(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/change-phone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ newPhone: fullPhone, otp }),
      });
      const result = await response.json();
      if (result.success) {
        setUserPhone(fullPhone);
        setShowSmsChangeModal(false);
        toast({ title: 'Success', description: 'Phone number changed successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to change phone', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to change phone:', error);
      toast({ title: 'Error', description: 'Failed to change phone', variant: 'destructive' });
    } finally {
      setVerifyingSmsChange(false);
    }
  };

  // Password Change Functions
  const handlePasswordChangeClick = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setShowPasswordChangeModal(true);
  };

  const changePassword = async () => {
    if (!currentPassword) {
      toast({ title: 'Validation', description: 'Please enter your current password', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: 'Validation', description: 'New password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({ title: 'Validation', description: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    setChangingPassword(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ oldPassword: currentPassword, newPassword }),
      });
      const result = await response.json();
      if (result.success) {
        setShowPasswordChangeModal(false);
        toast({ title: 'Success', description: 'Password changed successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to change password', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to change password:', error);
      toast({ title: 'Error', description: 'Failed to change password', variant: 'destructive' });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleWhitelistToggle = async () => {
    const next = !withdrawalWhitelist;
    setTogglingWhitelist(true);
    const result = await api.post<{ enabled?: boolean }>('/api/v1/auth/withdrawal-whitelist/toggle', {
      enabled: next,
    });
    if (result.success) {
      setWithdrawalWhitelist(typeof result.data?.enabled === 'boolean' ? result.data.enabled : next);
    }
    setTogglingWhitelist(false);
  };

  // Address Book Functions
  const handleAddressBookToggle = () => {
    if (!withdrawViaAddressBook) {
      setShowAddressBookModal(true);
    } else {
      toggleAddressBook(false);
    }
  };

  const enableAddressBook = async () => {
    setEnablingAddressBook(true);
    try {
      await toggleAddressBook(true);
      setShowAddressBookModal(false);
    } finally {
      setEnablingAddressBook(false);
    }
  };

  const toggleAddressBook = async (enable: boolean) => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/address-book/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ enabled: enable }),
      });
      const result = await response.json();
      if (result.success) {
        setWithdrawViaAddressBook(enable);
      }
    } catch (error) {
      console.error('Failed to toggle address book:', error);
    }
  };

  // OTP Input Component
  return (
    <div className="p-4 lg:p-8 bg-background min-h-full">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Security Center</h1>
          <p className="mt-2 text-muted-foreground">Protect your account with multiple layers of security</p>
        </div>

        {/* Security overview */}
        <div className="mb-8 overflow-hidden rounded-xl border border-border bg-card">
          <div className="p-6 lg:p-8">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
              <div className="flex items-center gap-6">
                <div
                  className={`flex h-20 w-20 items-center justify-center rounded-xl shadow-sm ${securityIconBg}`}
                >
                  <Shield className={`h-10 w-10 ${securityIconColor}`} />
                </div>
                <div>
                  <h2 className="mb-2 text-xl font-bold text-foreground">
                    Security Level: <span className={securityColor}>{securityStatus}</span>
                  </h2>
                  <p className="text-muted-foreground">Complete more security settings to increase protection</p>
                </div>
              </div>
              <div className="w-full lg:w-64">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Protection score</span>
                  <span className={`text-sm font-bold ${securityColor}`}>{securityLevel}%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-muted">
                  <div
                    className={`h-3 rounded-full transition-all duration-500 ${securityProgressClass}`}
                    style={{ width: `${securityLevel}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ['all', 'All'],
              ['login', 'Login & password'],
              ['twoFactor', 'Two-factor'],
              ['advanced', 'Advanced'],
              ['withdrawal', 'Withdrawals'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSecurityTab(id)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                securityTab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/** Section helper */}
        {(securityTab === 'all' || securityTab === 'login') && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Login & password</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <SecurityFeatureCard
                icon={Lock}
                title="Login password"
                description="Used for account login"
                status="Enabled"
                statusTone="enabled"
                actionLabel="Change"
                actionVariant="primary"
                onAction={handlePasswordChangeClick}
              />
              <SecurityFeatureCard
                icon={Monitor}
                title="Active sessions"
                description="See where you are signed in and sign out other devices"
                status="Review"
                statusTone="recommended"
                actionLabel="Manage"
                actionVariant="primary"
                onAction={() => router.push('/dashboard/security/sessions')}
              />
            </div>
          </section>
        )}

        {(securityTab === 'all' || securityTab === 'twoFactor') && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Two-factor authentication</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <SecurityFeatureCard
                icon={Mail}
                title="Email authentication"
                description={
                  <>
                    For login, withdrawal, and security verification.{' '}
                    <span className="cursor-pointer text-primary hover:underline">Unlink</span>
                  </>
                }
                status="Verified"
                statusTone="enabled"
                statusValue={maskEmail(user?.email || '')}
                actionLabel="Change email"
                actionVariant="default"
                onAction={handleEmailChangeClick}
              />
              <SecurityFeatureCard
                icon={Smartphone}
                title="Phone verification"
                description="Verify your mobile number and use SMS for login, password reset, and security actions"
                status={userPhone ? (smsAuthEnabled ? 'ON' : 'OFF') : 'Not configured'}
                statusTone={
                  userPhone ? (smsAuthEnabled ? 'enabled' : 'recommended') : 'neutral'
                }
                statusValue={userPhone ? maskPhone(userPhone) : undefined}
                loading={loadingPhone}
                actionLabel={userPhone ? 'Change' : 'Settings'}
                actionVariant={userPhone ? 'default' : 'primary'}
                onAction={userPhone ? handleSmsChangeClick : handleSmsSettingsClick}
                toggleEnabled={!!userPhone && smsAuthEnabled}
                onToggle={userPhone ? toggleSmsAuth : undefined}
                toggleLoading={togglingSmsAuth}
              />
              <SecurityFeatureCard
                icon={Shield}
                title="Google 2FA"
                description="Most secure verification for sensitive operations"
                status={user2faEnabled ? 'Enabled' : 'Not configured'}
                statusTone={user2faEnabled ? 'enabled' : 'recommended'}
                loading={loadingGoogle2fa}
                actionLabel="Manage"
                actionVariant="primary"
                onAction={() => router.push('/dashboard/security/2fa')}
              />
            </div>
          </section>
        )}

        {(securityTab === 'all' || securityTab === 'advanced') && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Advanced protection</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <SecurityFeatureCard
                icon={Fingerprint}
                title="Passkeys (Touch ID / Face ID)"
                description="Use biometrics for fast and secure login"
                status={passkeysCount > 0 ? `${passkeysCount} registered` : 'Not configured'}
                statusTone={passkeysCount > 0 ? 'enabled' : 'neutral'}
                loading={loadingPasskeys}
                actionLabel="Settings"
                actionVariant={passkeysCount > 0 ? 'default' : 'primary'}
                onAction={handlePasskeySettingsClick}
              />
              <SecurityFeatureCard
                icon={KeyRound}
                title="Fund password"
                description="Required for withdrawal, P2P trading, and other sensitive operations"
                status={hasFundPassword ? 'Enabled' : 'Not configured'}
                statusTone={hasFundPassword ? 'enabled' : 'neutral'}
                loading={loadingFundPassword}
                actionLabel={hasFundPassword ? 'Change' : 'Settings'}
                actionVariant={hasFundPassword ? 'default' : 'primary'}
                onAction={handleFundPasswordClick}
              />
              <SecurityFeatureCard
                icon={BadgeCheck}
                title="Anti-phishing code"
                description="This code appears in all official emails to prevent phishing"
                status={antiPhishingCode ? 'Enabled' : 'Not configured'}
                statusTone={antiPhishingCode ? 'enabled' : 'neutral'}
                statusValue={antiPhishingCode || undefined}
                loading={loadingAntiPhishing}
                actionLabel={antiPhishingCode ? 'Change' : 'Settings'}
                actionVariant={antiPhishingCode ? 'default' : 'primary'}
                onAction={handleAntiPhishingClick}
              />
            </div>
          </section>
        )}

        {(securityTab === 'all' || securityTab === 'withdrawal') && (
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Withdrawal security</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="font-semibold text-foreground">Withdrawal address whitelist</h3>
                    <p className="text-sm text-muted-foreground">
                      Skip verification for trusted addresses when enabled
                    </p>
                    <p
                      className={`inline-flex items-center gap-2 text-sm font-medium ${
                        withdrawalWhitelist ? 'text-buy' : 'text-muted-foreground'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          withdrawalWhitelist ? 'bg-buy' : 'bg-muted-foreground'
                        }`}
                      />
                      {withdrawalWhitelist ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end border-t border-border pt-4">
                  <ToggleSwitch
                    enabled={withdrawalWhitelist}
                    onChange={() => void handleWhitelistToggle()}
                    loading={loadingWhitelist || togglingWhitelist}
                  />
                </div>
              </div>

              <div className="flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="font-semibold text-foreground">Withdraw via address book</h3>
                    <p className="text-sm text-muted-foreground">
                      Only withdraw to saved addresses.{' '}
                      <Link href="/dashboard/address-book" className="text-primary hover:underline">
                        Manage addresses
                      </Link>
                    </p>
                    <p
                      className={`inline-flex items-center gap-2 text-sm font-medium ${
                        withdrawViaAddressBook ? 'text-buy' : 'text-muted-foreground'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          withdrawViaAddressBook ? 'bg-buy' : 'bg-muted-foreground'
                        }`}
                      />
                      {withdrawViaAddressBook ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end border-t border-border pt-4">
                  <ToggleSwitch
                    enabled={withdrawViaAddressBook}
                    onChange={handleAddressBookToggle}
                    loading={loadingAddressBook}
                  />
                </div>
              </div>

              <SecurityFeatureCard
                icon={MapPin}
                title="New address withdrawal lock"
                description="Disable withdrawals to newly saved addresses for 24 hours"
                status="Coming soon"
                statusTone="neutral"
                actionLabel="Settings"
                actionDisabled
              />
              <SecurityFeatureCard
                icon={Coins}
                title="Manage withdrawal limits"
                description="Configure daily and monthly withdrawal limits"
                actionLabel="Manage"
                actionVariant="primary"
                onAction={() => router.push('/dashboard/security/withdrawal-limits')}
              />
            </div>
          </section>
        )}
      </div>

      {/* ===== MODALS ===== */}

      <Modal show={showPhoneInputModal} onClose={() => setShowPhoneInputModal(false)} title="Phone verification">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
            <Smartphone className="w-8 h-8 text-primary" />
          </div>
          <p className="text-muted-foreground">Enter your phone number for SMS authentication</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCountryDropdown(!showCountryDropdown);
              }}
              className="flex items-center gap-2 px-4 py-3.5 bg-muted border border-border rounded-xl"
            >
              <span>{selectedCountry.flag}</span>
              <span>{selectedCountry.code}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {showCountryDropdown && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-xl z-10 max-h-60 overflow-y-auto">
                {countries.map(country => (
                  <button
                    key={country.code}
                    onClick={(e) => { 
                      e.stopPropagation();
                      setSelectedCountry(country); 
                      setShowCountryDropdown(false); 
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent"
                  >
                    <span>{country.flag}</span>
                    <span className="flex-1 text-left">{country.name}</span>
                    <span className="text-muted-foreground">{country.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="Phone number"
            className="flex-1 px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <button
          onClick={handlePhoneSubmit}
          disabled={phoneNumber.length < 10}
          className="w-full mt-6 py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors"
        >
          Continue
        </button>
      </Modal>

      {/* Phone OTP Modal */}
      <Modal show={showPhoneOtpModal} onClose={() => setShowPhoneOtpModal(false)} title="Phone Verification">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
            <Smartphone className="w-8 h-8 text-primary" />
          </div>
          <p className="text-muted-foreground">
            Enter the code sent to <span className="font-medium text-foreground">{selectedCountry.code}{phoneNumber}</span>
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          {phoneOtp.map((digit, i) => (
            <input
              key={`phone-otp-${i}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              autoComplete="off"
              onChange={(e) => {
                const val = e.target.value;
                if (!/^\d*$/.test(val)) return;
                const arr = [...phoneOtp];
                arr[i] = val.slice(-1);
                setPhoneOtp(arr);
                if (val && i < 5) phoneOtpRefs.current[i + 1]?.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !phoneOtp[i] && i > 0) phoneOtpRefs.current[i - 1]?.focus();
              }}
              ref={(el) => { phoneOtpRefs.current[i] = el; }}
              className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-primary focus:ring-2 focus:ring-ring/30 focus:outline-none"
            />
          ))}
        </div>
        <div className="flex justify-center mt-4">
          {phoneOtpTimer > 0 ? (
            <span className="text-sm text-muted-foreground">Resend in {phoneOtpTimer}s</span>
          ) : (
            <button onClick={sendPhoneOtp} disabled={sendingPhoneOtp} className="text-sm text-primary hover:underline">
              {sendingPhoneOtp ? 'Sending...' : 'Resend Code'}
            </button>
          )}
        </div>
        <button
          onClick={verifyPhoneOtp}
          disabled={verifyingPhoneOtp || phoneOtp.join('').length !== 6}
          className="w-full mt-6 py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {verifyingPhoneOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          Verify & Enable
        </button>
      </Modal>

      {/* Google 2FA Email OTP Modal */}
      <Modal show={showGoogle2faEmailOtpModal} onClose={() => setShowGoogle2faEmailOtpModal(false)} title="Email Verification">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
            <Shield className="h-8 w-8 text-buy" />
          </div>
          <p className="text-muted-foreground">Verify your email before enabling Google 2FA</p>
        </div>
        <div className="flex gap-3 justify-center">
          {google2faEmailOtp.map((digit, i) => (
            <input
              key={`google2fa-email-${i}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              autoComplete="off"
              onChange={(e) => {
                const val = e.target.value;
                if (!/^\d*$/.test(val)) return;
                const arr = [...google2faEmailOtp];
                arr[i] = val.slice(-1);
                setGoogle2faEmailOtp(arr);
                if (val && i < 5) google2faEmailOtpRefs.current[i + 1]?.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !google2faEmailOtp[i] && i > 0) google2faEmailOtpRefs.current[i - 1]?.focus();
              }}
              ref={(el) => { google2faEmailOtpRefs.current[i] = el; }}
              className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-primary focus:ring-2 focus:ring-ring/30 focus:outline-none"
            />
          ))}
        </div>
        <div className="flex justify-center mt-4">
          {google2faEmailOtpTimer > 0 ? (
            <span className="text-sm text-muted-foreground">Resend in {google2faEmailOtpTimer}s</span>
          ) : (
            <button onClick={sendGoogle2faEmailOtp} disabled={sendingGoogle2faEmailOtp} className="text-sm text-primary hover:underline">
              {sendingGoogle2faEmailOtp ? 'Sending...' : 'Resend Code'}
            </button>
          )}
        </div>
        <button
          onClick={verifyGoogle2faEmailOtp}
          disabled={verifyingGoogle2faEmailOtp || google2faEmailOtp.join('').length !== 6}
          className="w-full mt-6 py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {verifyingGoogle2faEmailOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          Continue
        </button>
      </Modal>

      {/* Google 2FA Setup Modal */}
      <Modal show={showGoogle2faSetupModal} onClose={() => setShowGoogle2faSetupModal(false)} title="Set Up Google 2FA">
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-muted-foreground mb-4">Scan this QR code with Google Authenticator</p>
            {google2faQrCode && (
              <img src={google2faQrCode} alt="2FA QR Code" className="w-48 h-48 mx-auto rounded-xl border border-border" />
            )}
          </div>
          <div className="p-4 bg-muted rounded-xl">
            <p className="text-xs text-muted-foreground mb-2">Or enter this key manually:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono text-foreground break-all">{google2faSecret}</code>
              <button
                onClick={() => navigator.clipboard.writeText(google2faSecret)}
                className="p-2 hover:bg-accent rounded-lg"
              >
                <Copy className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Enter 6-digit code</label>
            <input
              type="text"
              value={google2faCode}
              onChange={(e) => setGoogle2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl text-center text-xl font-mono tracking-widest outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <button
            onClick={enableGoogle2fa}
            disabled={enablingGoogle2fa || google2faCode.length !== 6}
            className="w-full py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {enablingGoogle2fa ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Enable 2FA
          </button>
        </div>
      </Modal>

      {/* Disable 2FA Confirm Modal */}
      <Modal show={showDisable2faConfirmModal} onClose={() => setShowDisable2faConfirmModal(false)} title="Disable Google 2FA">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
            <AlertTriangle className="h-8 w-8 text-sell" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Are you sure?</h3>
          <p className="text-muted-foreground">
            Disabling 2FA will reduce your account security. You will need your password and current 2FA code to proceed.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowDisable2faConfirmModal(false)}
            className="flex-1 py-3 bg-accent hover:bg-accent text-foreground/80 font-medium rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirmDisable2fa}
            className="flex-1 rounded-xl bg-sell py-3 font-medium text-primary-foreground transition-colors hover:bg-sell/90"
          >
            Continue
          </button>
        </div>
      </Modal>

      {/* Disable 2FA Verify Modal */}
      <Modal show={showDisable2faVerifyModal} onClose={() => setShowDisable2faVerifyModal(false)} title="Verify to Disable 2FA">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Password</label>
            <div className="relative">
              <input
                type={showDisablePassword ? 'text' : 'password'}
                value={disable2faPassword}
                onChange={(e) => setDisable2faPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 pr-12 text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowDisablePassword(!showDisablePassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
              >
                {showDisablePassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">2FA Code</label>
            <input
              type="text"
              value={disable2faCode}
              onChange={(e) => setDisable2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter 6-digit code"
              className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl text-center text-xl font-mono tracking-widest outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={disableGoogle2fa}
            disabled={disabling2fa || !disable2faPassword || disable2faCode.length !== 6}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sell py-3.5 font-semibold text-primary-foreground transition-colors hover:bg-sell/90 disabled:bg-muted disabled:text-muted-foreground"
          >
            {disabling2fa ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Disable 2FA
          </button>
        </div>
      </Modal>

      {/* Address Book Enable Modal */}
      <Modal show={showAddressBookModal} onClose={() => setShowAddressBookModal(false)} title="Enable Address Book Restriction">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
            <BookOpen className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Restrict Withdrawals</h3>
          <p className="text-muted-foreground">
            Once enabled, you can only withdraw to addresses saved in your Address Book.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddressBookModal(false)}
            className="flex-1 py-3 bg-accent hover:bg-accent text-foreground/80 font-medium rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={enableAddressBook}
            disabled={enablingAddressBook}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/85"
          >
            {enablingAddressBook ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Enable
          </button>
        </div>
      </Modal>

      {/* Email Change Modal */}
      <Modal show={showEmailChangeModal} onClose={() => setShowEmailChangeModal(false)} title="Change Email Address">
        <div className="space-y-6">
          {emailChangeStep === 'input' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
                  <Mail className="w-8 h-8 text-primary" />
                </div>
                <p className="text-muted-foreground">Enter your new email address</p>
              </div>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 text-foreground"
              />
              <button
                onClick={sendEmailChangeOtp}
                disabled={sendingEmailChangeOtp || !newEmail}
                className="w-full py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {sendingEmailChangeOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Continue
              </button>
            </>
          )}
          {emailChangeStep === 'verify' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
                  <Mail className="h-8 w-8 text-buy" />
                </div>
                <p className="text-muted-foreground">Enter the code sent to <span className="font-medium text-foreground">{newEmail}</span></p>
              </div>
              <div className="flex gap-3 justify-center">
                {emailChangeOtp.map((digit, i) => (
                  <input
                    key={`email-change-${i}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    autoComplete="off"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!/^\d*$/.test(val)) return;
                      const arr = [...emailChangeOtp];
                      arr[i] = val.slice(-1);
                      setEmailChangeOtp(arr);
                      if (val && i < 5) emailChangeOtpRefs.current[i + 1]?.focus();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !emailChangeOtp[i] && i > 0) emailChangeOtpRefs.current[i - 1]?.focus();
                    }}
                    ref={(el) => { emailChangeOtpRefs.current[i] = el; }}
                    className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-primary focus:ring-2 focus:ring-ring/30 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex justify-center">
                {emailChangeOtpTimer > 0 ? (
                  <span className="text-sm text-muted-foreground">Resend in {emailChangeOtpTimer}s</span>
                ) : (
                  <button onClick={sendEmailChangeOtp} disabled={sendingEmailChangeOtp} className="text-sm text-primary hover:underline">
                    {sendingEmailChangeOtp ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
              <button
                onClick={verifyEmailChange}
                disabled={verifyingEmailChange || emailChangeOtp.join('').length !== 6}
                className="w-full py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {verifyingEmailChange ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Verify & Change
              </button>
            </>
          )}
        </div>
      </Modal>

      {/* SMS Change Modal */}
      <Modal show={showSmsChangeModal} onClose={() => setShowSmsChangeModal(false)} title="Change Phone Number">
        <div className="space-y-6">
          {smsChangeStep === 'verify_current' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
                  <Smartphone className="w-8 h-8 text-primary" />
                </div>
                <p className="text-muted-foreground">Enter the code sent to your current phone <span className="font-medium text-foreground">{maskPhone(userPhone || '')}</span></p>
              </div>
              <div className="flex gap-3 justify-center">
                {currentPhoneOtp.map((digit, i) => (
                  <input
                    key={`sms-current-${i}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    autoComplete="off"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!/^\d*$/.test(val)) return;
                      const arr = [...currentPhoneOtp];
                      arr[i] = val.slice(-1);
                      setCurrentPhoneOtp(arr);
                      if (val && i < 5) currentPhoneOtpRefs.current[i + 1]?.focus();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !currentPhoneOtp[i] && i > 0) currentPhoneOtpRefs.current[i - 1]?.focus();
                    }}
                    ref={(el) => { currentPhoneOtpRefs.current[i] = el; }}
                    className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-primary focus:ring-2 focus:ring-ring/30 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex justify-center">
                {smsChangeOtpTimer > 0 ? (
                  <span className="text-sm text-muted-foreground">Resend in {smsChangeOtpTimer}s</span>
                ) : (
                  <button onClick={sendCurrentPhoneOtp} disabled={sendingSmsChangeOtp} className="text-sm text-primary hover:underline">
                    {sendingSmsChangeOtp ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
              <button
                onClick={verifyCurrentPhoneAndContinue}
                disabled={verifyingSmsChange || currentPhoneOtp.join('').length !== 6}
                className="w-full py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {verifyingSmsChange ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Verify & Continue
              </button>
            </>
          )}
          {smsChangeStep === 'input_new' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
                  <Smartphone className="h-8 w-8 text-buy" />
                </div>
                <p className="text-muted-foreground">Enter your new phone number</p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                    className="px-4 py-3.5 bg-muted border border-border rounded-xl flex items-center gap-2 min-w-[100px]"
                  >
                    <span>{selectedCountry?.flag}</span>
                    <span className="text-foreground">{selectedCountry?.code}</span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </button>
                  {showCountryDropdown && (
                    <div className="absolute top-full mt-1 w-48 bg-card border border-border rounded-xl shadow-lg z-10 max-h-48 overflow-auto">
                      {countries.map((country) => (
                        <button
                          key={country.code}
                          onClick={() => { setSelectedCountry(country); setShowCountryDropdown(false); }}
                          className="w-full px-4 py-2 flex items-center gap-2 hover:bg-accent text-left"
                        >
                          <span>{country.flag}</span>
                          <span className="text-foreground">{country.name}</span>
                          <span className="text-muted-foreground ml-auto">{country.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="tel"
                  value={newPhoneNumber}
                  onChange={(e) => setNewPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder="Phone number"
                  className="flex-1 px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 text-foreground"
                />
              </div>
              <button
                onClick={sendNewPhoneOtp}
                disabled={sendingSmsChangeOtp || !newPhoneNumber}
                className="w-full py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {sendingSmsChangeOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Continue
              </button>
            </>
          )}
          {smsChangeStep === 'verify_new' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center mb-4">
                  <Smartphone className="h-8 w-8 text-buy" />
                </div>
                <p className="text-muted-foreground">Enter the code sent to <span className="font-medium text-foreground">{selectedCountry?.code}{newPhoneNumber}</span></p>
              </div>
              <div className="flex gap-3 justify-center">
                {newPhoneOtp.map((digit, i) => (
                  <input
                    key={`sms-new-${i}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    autoComplete="off"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!/^\d*$/.test(val)) return;
                      const arr = [...newPhoneOtp];
                      arr[i] = val.slice(-1);
                      setNewPhoneOtp(arr);
                      if (val && i < 5) newPhoneOtpRefs.current[i + 1]?.focus();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !newPhoneOtp[i] && i > 0) newPhoneOtpRefs.current[i - 1]?.focus();
                    }}
                    ref={(el) => { newPhoneOtpRefs.current[i] = el; }}
                    className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-primary focus:ring-2 focus:ring-ring/30 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex justify-center">
                {smsChangeOtpTimer > 0 ? (
                  <span className="text-sm text-muted-foreground">Resend in {smsChangeOtpTimer}s</span>
                ) : (
                  <button onClick={sendNewPhoneOtp} disabled={sendingSmsChangeOtp} className="text-sm text-primary hover:underline">
                    {sendingSmsChangeOtp ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
              <button
                onClick={verifyNewPhoneAndSave}
                disabled={verifyingSmsChange || newPhoneOtp.join('').length !== 6}
                className="w-full py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {verifyingSmsChange ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Verify & Save
              </button>
            </>
          )}
        </div>
      </Modal>

      {/* Password Change Modal */}
      <Modal show={showPasswordChangeModal} onClose={() => setShowPasswordChangeModal(false)} title="Change Password">
        <div className="space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <p className="text-muted-foreground">Enter your current password and new password</p>
          </div>
          <div className="space-y-4">
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 text-foreground pr-12"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
              >
                {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 characters)"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 text-foreground pr-12"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <div className="relative">
              <input
                type={showConfirmNewPassword ? 'text' : 'password'}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 text-foreground pr-12"
              />
              <button
                type="button"
                onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
              >
                {showConfirmNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <button
            onClick={changePassword}
            disabled={changingPassword || !currentPassword || !newPassword || newPassword !== confirmNewPassword}
            className="w-full py-3.5 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {changingPassword ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Change Password
          </button>
        </div>
      </Modal>

      {/* Passkey Settings Modal */}
      <Modal show={showPasskeyModal} onClose={() => setShowPasskeyModal(false)} title="Passkey Settings">
        <div className="space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-xl bg-primary shadow-sm">
              <Fingerprint className="h-10 w-10 text-primary-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {passkeys.length > 0 ? 'Manage Passkeys' : 'Enable Touch ID / Face ID'}
            </h3>
            <p className="text-muted-foreground text-sm">
              {passkeys.length > 0 
                ? 'Your device is registered for biometric login'
                : 'Login instantly with your fingerprint or face'
              }
            </p>
          </div>

          {/* Register New Passkey - Only show if no passkeys */}
          {passkeys.length === 0 && (
            <button
              onClick={registerPasskey}
              disabled={registeringPasskey}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary py-4 font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground"
            >
              {registeringPasskey ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Setting up...
                </>
              ) : (
                <>
                  <Fingerprint className="w-6 h-6" />
                  Enable with Touch ID / Face ID
                </>
              )}
            </button>
          )}

          {/* Registered Passkeys */}
          {passkeys.length > 0 && (
            <div className="space-y-3">
              {passkeys.map((passkey) => (
                <div
                  key={passkey.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-buy/10 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center">
                      <Check className="h-6 w-6 text-buy" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{passkey.device_name || 'This Device'}</p>
                      <p className="text-xs text-buy">
                        Registered {new Date(passkey.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => deletePasskey(passkey.id)}
                    disabled={deletingPasskeyId === passkey.id}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-sell transition-colors hover:bg-muted"
                  >
                    {deletingPasskeyId === passkey.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Remove'
                    )}
                  </button>
                </div>
              ))}

              {/* Add another device option */}
              <button
                onClick={registerPasskey}
                disabled={registeringPasskey}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 font-medium text-muted-foreground transition-all hover:border-primary hover:text-primary"
              >
                {registeringPasskey ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-5 h-5" />
                    Add Another Device
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
