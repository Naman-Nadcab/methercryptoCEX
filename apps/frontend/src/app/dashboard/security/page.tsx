'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import Link from 'next/link';
import {
  Lock,
  Mail,
  Smartphone,
  Shield,
  Key,
  Phone,
  KeyRound,
  ShieldCheck,
  Wallet,
  BookOpen,
  MapPin,
  Coins,
  X,
  ChevronDown,
  Loader2,
  Check,
  AlertTriangle,
  ChevronRight,
  Eye,
  EyeOff,
  Copy,
  ShieldAlert,
  Settings,
  Fingerprint,
  BadgeCheck,
  Trash2,
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
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div 
        className="relative bg-card rounded-xl w-full max-w-md shadow-2xl z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-xl transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

// Reusable SecurityRow Component
const SecurityRow = ({
  icon: Icon,
  iconBg,
  title,
  description,
  status,
  statusColor,
  statusValue,
  loading,
  actionLabel,
  actionVariant = 'default',
  onAction,
  secondaryAction,
  secondaryLabel,
  toggleEnabled,
  onToggle,
  toggleLoading,
}: {
  icon: any;
  iconBg: string;
  title: string;
  description?: string | React.ReactNode;
  status?: string;
  statusColor?: string;
  statusValue?: string;
  loading?: boolean;
  actionLabel: string;
  actionVariant?: 'default' | 'primary' | 'danger';
  onAction?: () => void;
  secondaryAction?: () => void;
  secondaryLabel?: string;
  toggleEnabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  toggleLoading?: boolean;
}) => (
  <div className="flex flex-col lg:flex-row lg:items-center justify-between p-5 hover:bg-accent/30 transition-colors gap-4">
    <div className="flex items-start lg:items-center gap-4">
      <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
    </div>
    <div className="flex items-center gap-4 ml-16 lg:ml-0">
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      ) : (
        <>
          {status && (
            <span className={`flex items-center gap-2 text-sm font-medium ${statusColor}`}>
              <span className={`w-2 h-2 rounded-full ${
                statusColor?.includes('green') ? 'bg-green-500' : 
                statusColor?.includes('orange') ? 'bg-orange-500' : 'bg-gray-400'
              }`}></span>
              {statusValue || status}
            </span>
          )}
          {onToggle && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!toggleLoading) {
                  onToggle(!toggleEnabled);
                }
              }}
              disabled={toggleLoading}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                toggleEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
              } ${toggleLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {toggleLoading ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                </span>
              ) : (
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-card shadow-lg transition-transform ${
                    toggleEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              )}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction}
              className="px-4 py-2.5 text-sm font-medium text-foreground/80 bg-accent hover:bg-accent rounded-xl transition-colors"
            >
              {secondaryLabel}
            </button>
          )}
          <button
            onClick={onAction}
            className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              actionVariant === 'primary'
                ? 'bg-primary hover:bg-primary/85 text-white shadow-lg shadow-blue-500/25'
                : actionVariant === 'danger'
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25'
                : 'bg-accent hover:bg-accent text-foreground/80'
            }`}
          >
            {actionLabel}
          </button>
        </>
      )}
    </div>
  </div>
);

// Toggle Switch Component
const ToggleSwitch = ({ enabled, onChange, loading }: { enabled: boolean; onChange: () => void; loading?: boolean }) => {
  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-gray-400" />;
  return (
    <button
      onClick={onChange}
      className={`relative w-14 h-8 rounded-full transition-colors ${
        enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`absolute top-1 w-6 h-6 bg-card rounded-full transition-all shadow-lg ${
          enabled ? 'right-1' : 'left-1'
        }`}
      />
    </button>
  );
};

// Section Card Component
const SectionCard = ({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  children,
}: {
  icon: any;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) => (
  <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
    <div className="px-6 py-4 border-b border-border flex items-center gap-4">
      <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center`}>
        <Icon className={`w-6 h-6 ${iconColor}`} />
      </div>
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
    <div className="divide-y divide-border">
      {children}
    </div>
  </div>
);

export default function SecurityPage() {
  const router = useRouter();
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const [withdrawalWhitelist, setWithdrawalWhitelist] = useState(false);
  const [withdrawViaAddressBook, setWithdrawViaAddressBook] = useState(false);
  const [newAddressLock, setNewAddressLock] = useState(false);
  const [loadingWhitelist, setLoadingWhitelist] = useState(true);
  
  // Withdrawal Whitelist Verification Modal States
  const [showWhitelistVerifyModal, setShowWhitelistVerifyModal] = useState(false);
  const [whitelistEmailOtp, setWhitelistEmailOtp] = useState('');
  const [whitelistEmailOtpTimer, setWhitelistEmailOtpTimer] = useState(0);
  const [sendingWhitelistOtp, setSendingWhitelistOtp] = useState(false);
  const [whitelistGoogle2faCode, setWhitelistGoogle2faCode] = useState('');
  const [verifyingWhitelist, setVerifyingWhitelist] = useState(false);
  
  // Withdraw via Address Book Modal States
  const [showAddressBookModal, setShowAddressBookModal] = useState(false);
  const [loadingAddressBook, setLoadingAddressBook] = useState(true);
  const [enablingAddressBook, setEnablingAddressBook] = useState(false);
  
  // SMS Setup Flow States
  const [showEmailOtpModal, setShowEmailOtpModal] = useState(false);
  const [showPhoneInputModal, setShowPhoneInputModal] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [showPhoneOtpModal, setShowPhoneOtpModal] = useState(false);
  
  // Form States
  const [emailOtp, setEmailOtp] = useState(['', '', '', '', '', '']);
  const [phoneOtp, setPhoneOtp] = useState(['', '', '', '', '', '']);
  const [selectedCountry, setSelectedCountry] = useState(countries[0]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  
  // Loading/Timer States
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState(false);
  const [sendingPhoneOtp, setSendingPhoneOtp] = useState(false);
  const [verifyingPhoneOtp, setVerifyingPhoneOtp] = useState(false);
  const [emailOtpTimer, setEmailOtpTimer] = useState(0);
  const [phoneOtpTimer, setPhoneOtpTimer] = useState(0);
  
  // Captcha State
  const [captchaPosition, setCaptchaPosition] = useState(0);
  const [captchaTarget, setCaptchaTarget] = useState(70);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [dragging, setDragging] = useState(false);
  
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
  const [showFundPasswordModal, setShowFundPasswordModal] = useState(false);
  const [showFundPassword2faModal, setShowFundPassword2faModal] = useState(false);
  const [fundPassword, setFundPassword] = useState('');
  const [confirmFundPassword, setConfirmFundPassword] = useState('');
  const [showFundPasswordInput, setShowFundPasswordInput] = useState(false);
  const [showConfirmFundPasswordInput, setShowConfirmFundPasswordInput] = useState(false);
  const [fundPassword2faCode, setFundPassword2faCode] = useState(['', '', '', '', '', '']);
  const [settingFundPassword, setSettingFundPassword] = useState(false);
  const [verifyingFundPassword2fa, setVerifyingFundPassword2fa] = useState(false);
  const [hasFundPassword, setHasFundPassword] = useState(false);
  const [loadingFundPassword, setLoadingFundPassword] = useState(true);
  const fundPassword2faRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Anti-Phishing Code States
  const [showAntiPhishingModal, setShowAntiPhishingModal] = useState(false);
  const [antiPhishingCode, setAntiPhishingCode] = useState('');
  const [antiPhishingCodeInput, setAntiPhishingCodeInput] = useState('');
  const [oldAntiPhishingCodeInput, setOldAntiPhishingCodeInput] = useState('');
  const [savingAntiPhishing, setSavingAntiPhishing] = useState(false);
  const [loadingAntiPhishing, setLoadingAntiPhishing] = useState(true);
  const [isChangingAntiPhishing, setIsChangingAntiPhishing] = useState(false);

  const apiUrl = getApiBaseUrl();
  
  // Refs for OTP inputs
  const emailOtpRefs = useRef<(HTMLInputElement | null)[]>([]);
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
  const securityColor = securityLevel >= 80 ? 'text-green-500' : securityLevel >= 50 ? 'text-yellow-500' : 'text-orange-500';
  const securityBgColor = securityLevel >= 80 ? 'from-green-500 to-green-400' : securityLevel >= 50 ? 'from-yellow-500 to-yellow-400' : 'from-orange-500 to-orange-400';

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
        const smsAuthRes = await fetch(`${apiUrl}/api/v1/auth/sms-auth/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const smsAuthResult = await smsAuthRes.json();
        if (smsAuthResult.success) {
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
        const whitelistRes = await fetch(`${apiUrl}/api/v1/auth/withdrawal-whitelist/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const whitelistResult = await whitelistRes.json();
        if (whitelistResult.success) {
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

  // Timer effects
  useEffect(() => {
    if (emailOtpTimer > 0) {
      const timer = setTimeout(() => setEmailOtpTimer(emailOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [emailOtpTimer]);

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
    if (whitelistEmailOtpTimer > 0) {
      const timer = setTimeout(() => setWhitelistEmailOtpTimer(whitelistEmailOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [whitelistEmailOtpTimer]);

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
      const response = await fetch(`${apiUrl}/api/v1/auth/sms-auth/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json();
      if (result.success) {
        setSmsAuthEnabled(enabled);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to update SMS authentication', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to toggle SMS auth:', error);
      toast({ title: 'Error', description: 'Failed to update SMS authentication', variant: 'destructive' });
    } finally {
      setTogglingSmsAuth(false);
    }
  };

  // SMS Setup Flow
  const handleSmsSettingsClick = () => {
    setShowEmailOtpModal(true);
    sendEmailOtp();
  };

  const sendEmailOtp = async () => {
    if (sendingEmailOtp || emailOtpTimer > 0) return;
    setSendingEmailOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', purpose: 'sms_setup' }),
      });
      const result = await response.json();
      if (result.success) {
        setEmailOtpTimer(60);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send email OTP:', error);
      toast({ title: 'Error', description: 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const verifyEmailOtp = async () => {
    const otp = emailOtp.join('');
    if (otp.length !== 6) return;
    
    setVerifyingEmailOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/verify-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', otp, purpose: 'sms_setup' }),
      });
      const result = await response.json();
      if (result.success) {
        setShowEmailOtpModal(false);
        setShowPhoneInputModal(true);
        setEmailOtp(['', '', '', '', '', '']);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Invalid OTP', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to verify email OTP:', error);
      toast({ title: 'Error', description: 'Failed to verify OTP', variant: 'destructive' });
    } finally {
      setVerifyingEmailOtp(false);
    }
  };

  const handlePhoneSubmit = () => {
    if (phoneNumber.length < 10) {
      toast({ title: 'Validation', description: 'Please enter a valid phone number', variant: 'destructive' });
      return;
    }
    setShowPhoneInputModal(false);
    setShowCaptchaModal(true);
    setCaptchaPosition(0);
    setCaptchaVerified(false);
    setCaptchaTarget(Math.floor(Math.random() * 40) + 50);
  };

  const handleCaptchaDrag = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    const slider = (e.target as HTMLElement).closest('.captcha-slider');
    if (!slider) return;
    
    const rect = slider.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const position = ((clientX - rect.left) / rect.width) * 100;
    setCaptchaPosition(Math.max(0, Math.min(100, position)));
  };

  const verifyCaptcha = () => {
    if (Math.abs(captchaPosition - captchaTarget) < 5) {
      setCaptchaVerified(true);
      setTimeout(() => {
        setShowCaptchaModal(false);
        setShowPhoneOtpModal(true);
        sendPhoneOtp();
      }, 500);
    } else {
      setCaptchaPosition(0);
      toast({ title: 'Validation', description: 'Please complete the puzzle correctly', variant: 'destructive' });
    }
  };

  const sendPhoneOtp = async () => {
    if (sendingPhoneOtp || phoneOtpTimer > 0) return;
    setSendingPhoneOtp(true);
    try {
      const fullPhone = selectedCountry.code + phoneNumber;
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'phone', phone: fullPhone, purpose: 'sms_setup' }),
      });
      const result = await response.json();
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
    const otp = phoneOtp.join('');
    if (otp.length !== 6) return;
    
    setVerifyingPhoneOtp(true);
    try {
      const fullPhone = selectedCountry.code + phoneNumber;
      const response = await fetch(`${apiUrl}/api/v1/auth/verify-phone-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ phone: fullPhone, otp }),
      });
      const result = await response.json();
      if (result.success) {
        setUserPhone(fullPhone);
        setShowPhoneOtpModal(false);
        setPhoneOtp(['', '', '', '', '', '']);
        setPhoneNumber('');
        toast({ title: 'Success', description: 'Phone number verified successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Invalid OTP', variant: 'destructive' });
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

  // Fund Password Functions
  const handleFundPasswordClick = () => {
    setShowFundPasswordModal(true);
    setFundPassword('');
    setConfirmFundPassword('');
  };

  const validateFundPassword = () => {
    if (fundPassword.length < 6) {
      toast({ title: 'Validation', description: 'Fund password must be at least 6 characters', variant: 'destructive' });
      return false;
    }
    if (fundPassword !== confirmFundPassword) {
      toast({ title: 'Validation', description: 'Passwords do not match', variant: 'destructive' });
      return false;
    }
    return true;
  };

  const submitFundPassword = () => {
    if (!validateFundPassword()) return;
    
    if (user2faEnabled) {
      setShowFundPasswordModal(false);
      setShowFundPassword2faModal(true);
    } else {
      saveFundPassword();
    }
  };

  const saveFundPassword = async () => {
    setSettingFundPassword(true);
    try {
      const code = fundPassword2faCode.join('');
      const response = await fetch(`${apiUrl}/api/v1/auth/fund-password/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ 
          fundPassword,
          twoFactorCode: user2faEnabled ? code : undefined 
        }),
      });
      const result = await response.json();
      
      if (result.success) {
        setHasFundPassword(true);
        setShowFundPasswordModal(false);
        setShowFundPassword2faModal(false);
        setFundPassword('');
        setConfirmFundPassword('');
        setFundPassword2faCode(['', '', '', '', '', '']);
        toast({ title: 'Success', description: 'Fund password set successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to set fund password', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to set fund password:', error);
      toast({ title: 'Error', description: 'Failed to set fund password', variant: 'destructive' });
    } finally {
      setSettingFundPassword(false);
      setVerifyingFundPassword2fa(false);
    }
  };

  const verifyFundPassword2fa = () => {
    const code = fundPassword2faCode.join('');
    if (code.length !== 6) {
      toast({ title: 'Validation', description: 'Please enter a valid 6-digit code', variant: 'destructive' });
      return;
    }
    setVerifyingFundPassword2fa(true);
    saveFundPassword();
  };

  // Anti-Phishing Functions
  const handleAntiPhishingClick = () => {
    if (antiPhishingCode) {
      setIsChangingAntiPhishing(true);
      setOldAntiPhishingCodeInput('');
    } else {
      setIsChangingAntiPhishing(false);
    }
    setAntiPhishingCodeInput('');
    setShowAntiPhishingModal(true);
  };

  const saveAntiPhishing = async () => {
    if (antiPhishingCodeInput.length < 4 || antiPhishingCodeInput.length > 20) {
      toast({ title: 'Validation', description: 'Anti-phishing code must be 4-20 characters', variant: 'destructive' });
      return;
    }
    if (isChangingAntiPhishing && oldAntiPhishingCodeInput !== antiPhishingCode) {
      toast({ title: 'Validation', description: 'Old anti-phishing code is incorrect', variant: 'destructive' });
      return;
    }

    setSavingAntiPhishing(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/anti-phishing/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ code: antiPhishingCodeInput }),
      });
      const result = await response.json();
      
      if (result.success) {
        setAntiPhishingCode(antiPhishingCodeInput);
        setShowAntiPhishingModal(false);
        setAntiPhishingCodeInput('');
        setOldAntiPhishingCodeInput('');
        toast({ title: 'Success', description: 'Anti-phishing code saved successfully', variant: 'success' });
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to save anti-phishing code', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to save anti-phishing code:', error);
      toast({ title: 'Error', description: 'Failed to save anti-phishing code', variant: 'destructive' });
    } finally {
      setSavingAntiPhishing(false);
    }
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
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'phone', purpose: 'phone_change' }),
      });
      const result = await response.json();
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
    const otp = currentPhoneOtp.join('');
    if (otp.length !== 6) {
      toast({ title: 'Validation', description: 'Please enter a valid 6-digit code', variant: 'destructive' });
      return;
    }
    setVerifyingSmsChange(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/verify-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'phone', otp, purpose: 'phone_change' }),
      });
      const result = await response.json();
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

  // Withdrawal Whitelist Functions
  const handleWhitelistToggle = () => {
    if (!withdrawalWhitelist) {
      setShowWhitelistVerifyModal(true);
      sendWhitelistOtp();
    } else {
      toggleWhitelist(false);
    }
  };

  const sendWhitelistOtp = async () => {
    if (sendingWhitelistOtp || whitelistEmailOtpTimer > 0) return;
    setSendingWhitelistOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', purpose: 'whitelist_enable' }),
      });
      const result = await response.json();
      if (result.success) {
        setWhitelistEmailOtpTimer(60);
      }
    } catch (error) {
      console.error('Failed to send OTP:', error);
    } finally {
      setSendingWhitelistOtp(false);
    }
  };

  const verifyWhitelistAndEnable = async () => {
    if (!whitelistEmailOtp || whitelistEmailOtp.length !== 6) {
      toast({ title: 'Validation', description: 'Please enter a valid OTP', variant: 'destructive' });
      return;
    }
    if (user2faEnabled && (!whitelistGoogle2faCode || whitelistGoogle2faCode.length !== 6)) {
      toast({ title: 'Validation', description: 'Please enter a valid 2FA code', variant: 'destructive' });
      return;
    }

    setVerifyingWhitelist(true);
    try {
      const verifyResponse = await fetch(`${apiUrl}/api/v1/auth/verify-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', otp: whitelistEmailOtp, purpose: 'whitelist_enable' }),
      });
      const verifyResult = await verifyResponse.json();
      
      if (!verifyResult.success) {
        toast({ title: 'Error', description: 'Invalid OTP', variant: 'destructive' });
        return;
      }

      if (user2faEnabled) {
        const twoFaResponse = await fetch(`${apiUrl}/api/v1/auth/2fa/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ code: whitelistGoogle2faCode }),
        });
        const twoFaResult = await twoFaResponse.json();
        
        if (!twoFaResult.success) {
          toast({ title: 'Error', description: 'Invalid 2FA code', variant: 'destructive' });
          return;
        }
      }

      await toggleWhitelist(true);
      setShowWhitelistVerifyModal(false);
      setWhitelistEmailOtp('');
      setWhitelistGoogle2faCode('');
    } catch (error) {
      console.error('Failed to verify:', error);
      toast({ title: 'Error', description: 'Verification failed', variant: 'destructive' });
    } finally {
      setVerifyingWhitelist(false);
    }
  };

  const toggleWhitelist = async (enable: boolean) => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/withdrawal-whitelist/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ enabled: enable }),
      });
      const result = await response.json();
      if (result.success) {
        setWithdrawalWhitelist(enable);
      }
    } catch (error) {
      console.error('Failed to toggle whitelist:', error);
    }
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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Security Center</h1>
          <p className="text-muted-foreground mt-2">Protect your account with multiple layers of security</p>
        </div>

        {/* Security Overview Card */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              {/* Left: Security Level */}
              <div className="flex items-center gap-6">
                <div className={`w-20 h-20 rounded-xl bg-gradient-to-br ${securityBgColor} flex items-center justify-center shadow-lg`}>
                  <Shield className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-2">Security Level: <span className={securityColor}>{securityStatus}</span></h2>
                  <p className="text-muted-foreground">Complete more security settings to increase protection</p>
                </div>
              </div>

              {/* Right: Progress */}
              <div className="w-full lg:w-64">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground/80">Protection Score</span>
                  <span className={`text-sm font-bold ${securityColor}`}>{securityLevel}%</span>
                </div>
                <div className="w-full bg-accent rounded-full h-3">
                  <div 
                    className={`h-3 rounded-full bg-gradient-to-r ${securityBgColor} transition-all duration-500`} 
                    style={{ width: `${securityLevel}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Password Section */}
        <SectionCard
          icon={Lock}
          iconBg="bg-blue-100 dark:bg-blue-900/30"
          iconColor="text-primary"
          title="Password"
          subtitle="Manage your login credentials"
        >
          <SecurityRow
            icon={Lock}
            iconBg="bg-accent text-gray-500"
            title="Login Password"
            description="Used for account login"
            status="Set up"
            statusColor="text-green-500"
            actionLabel="Change"
            onAction={handlePasswordChangeClick}
          />
        </SectionCard>

        {/* Two-Factor Authentication */}
        <SectionCard
          icon={ShieldCheck}
          iconBg="bg-green-100 dark:bg-green-900/30"
          iconColor="text-buy"
          title="Two-Factor Authentication"
          subtitle="Add extra layers of security to your account"
        >
          <SecurityRow
            icon={Mail}
            iconBg="bg-accent text-gray-500"
            title="Email Authentication"
            description={<>For login, withdrawal, and security verification. <span className="text-blue-500 cursor-pointer hover:underline">Unlink</span></>}
            status="Verified"
            statusColor="text-green-500"
            statusValue={maskEmail(user?.email || '')}
            actionLabel="Change Email"
            onAction={handleEmailChangeClick}
          />
          <SecurityRow
            icon={Smartphone}
            iconBg={userPhone && smsAuthEnabled ? "bg-green-100 dark:bg-green-900/30 text-green-600" : "bg-accent text-gray-500"}
            title="SMS Authentication"
            description="For login, password reset, and security settings"
            status={userPhone ? (smsAuthEnabled ? 'ON' : 'OFF') : 'Not Configured'}
            statusColor={userPhone ? (smsAuthEnabled ? 'text-green-500' : 'text-orange-500') : 'text-gray-400'}
            statusValue={userPhone ? maskPhone(userPhone) : undefined}
            loading={loadingPhone}
            actionLabel={userPhone ? 'Change' : 'Settings'}
            actionVariant={userPhone ? 'default' : 'primary'}
            onAction={userPhone ? handleSmsChangeClick : handleSmsSettingsClick}
            toggleEnabled={!!userPhone && smsAuthEnabled}
            onToggle={userPhone ? toggleSmsAuth : undefined}
            toggleLoading={togglingSmsAuth}
          />
          <SecurityRow
            icon={Shield}
            iconBg="bg-accent text-gray-500"
            title="Google 2FA"
            description="Most secure verification for sensitive operations"
            status={user2faEnabled ? 'Enabled' : 'Not Configured'}
            statusColor={user2faEnabled ? 'text-green-500' : 'text-gray-400'}
            loading={loadingGoogle2fa}
            actionLabel={user2faEnabled ? 'Disable' : 'Settings'}
            actionVariant={user2faEnabled ? 'danger' : 'primary'}
            onAction={user2faEnabled ? handleDisable2faClick : handleGoogle2faSettingsClick}
          />
        </SectionCard>

        {/* Advanced Protection */}
        <SectionCard
          icon={Fingerprint}
          iconBg="bg-purple-100 dark:bg-purple-900/30"
          iconColor="text-purple-600 dark:text-purple-400"
          title="Advanced Protection"
          subtitle="Additional security features for enhanced protection"
        >
          <SecurityRow
            icon={Fingerprint}
            iconBg="bg-accent text-gray-500"
            title="Passkeys (Touch ID / Face ID)"
            description="Use biometrics for fast and secure login"
            status={passkeysCount > 0 ? `${passkeysCount} Registered` : 'Not Configured'}
            statusColor={passkeysCount > 0 ? 'text-green-500' : 'text-gray-400'}
            loading={loadingPasskeys}
            actionLabel="Settings"
            actionVariant={passkeysCount > 0 ? 'default' : 'primary'}
            onAction={handlePasskeySettingsClick}
          />
          <SecurityRow
            icon={KeyRound}
            iconBg="bg-accent text-gray-500"
            title="Fund Password"
            description="Required for withdrawal, P2P trading, and other sensitive operations"
            status={hasFundPassword ? 'Set up' : 'Not Configured'}
            statusColor={hasFundPassword ? 'text-green-500' : 'text-gray-400'}
            loading={loadingFundPassword}
            actionLabel={hasFundPassword ? 'Change' : 'Settings'}
            actionVariant={hasFundPassword ? 'default' : 'primary'}
            onAction={handleFundPasswordClick}
          />
          <SecurityRow
            icon={BadgeCheck}
            iconBg="bg-accent text-gray-500"
            title="Anti-Phishing Code"
            description="This code appears in all official emails to prevent phishing"
            status={antiPhishingCode ? 'Set up' : 'Not Configured'}
            statusColor={antiPhishingCode ? 'text-green-500' : 'text-gray-400'}
            statusValue={antiPhishingCode || undefined}
            loading={loadingAntiPhishing}
            actionLabel={antiPhishingCode ? 'Change' : 'Settings'}
            actionVariant={antiPhishingCode ? 'default' : 'primary'}
            onAction={handleAntiPhishingClick}
          />
        </SectionCard>

        {/* Withdrawal Security */}
        <SectionCard
          icon={Wallet}
          iconBg="bg-orange-100 dark:bg-orange-900/30"
          iconColor="text-orange-600 dark:text-orange-400"
          title="Withdrawal Security"
          subtitle="Control how and where you can withdraw funds"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between p-5 hover:bg-accent/30 transition-colors gap-4">
            <div className="flex items-start lg:items-center gap-4">
              <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-6 h-6 text-gray-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Withdrawal Address Whitelist</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Skip verification for trusted addresses when enabled
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 ml-16 lg:ml-0">
              <span className={`flex items-center gap-2 text-sm font-medium ${withdrawalWhitelist ? 'text-green-500' : 'text-gray-400'}`}>
                <span className={`w-2 h-2 rounded-full ${withdrawalWhitelist ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                {withdrawalWhitelist ? 'Enabled' : 'Disabled'}
              </span>
              <ToggleSwitch enabled={withdrawalWhitelist} onChange={handleWhitelistToggle} loading={loadingWhitelist} />
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between p-5 hover:bg-accent/30 transition-colors gap-4">
            <div className="flex items-start lg:items-center gap-4">
              <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-6 h-6 text-gray-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Withdraw via Address Book</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Only withdraw to saved addresses.{' '}
                  <Link href="/dashboard/address-book" className="text-blue-500 hover:underline">Manage Addresses</Link>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 ml-16 lg:ml-0">
              <span className={`flex items-center gap-2 text-sm font-medium ${withdrawViaAddressBook ? 'text-green-500' : 'text-gray-400'}`}>
                <span className={`w-2 h-2 rounded-full ${withdrawViaAddressBook ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                {withdrawViaAddressBook ? 'Enabled' : 'Disabled'}
              </span>
              <ToggleSwitch enabled={withdrawViaAddressBook} onChange={handleAddressBookToggle} loading={loadingAddressBook} />
            </div>
          </div>

          <SecurityRow
            icon={MapPin}
            iconBg="bg-accent text-gray-400"
            title="New Address Withdrawal Lock"
            description="Disable withdrawals to newly saved addresses for 24 hours"
            status="Coming Soon"
            statusColor="text-gray-400"
            actionLabel="Settings"
          />

          <SecurityRow
            icon={Coins}
            iconBg="bg-accent text-gray-500"
            title="Manage Withdrawal Limits"
            description="Configure daily and monthly withdrawal limits"
            actionLabel="Manage"
            onAction={() => router.push('/dashboard/security/withdrawal-limits')}
          />
        </SectionCard>
      </div>

      {/* ===== MODALS ===== */}

      {/* Email OTP Modal (SMS Setup) */}
      <Modal show={showEmailOtpModal} onClose={() => setShowEmailOtpModal(false)} title="Email Verification">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <Mail className="w-8 h-8 text-blue-500" />
          </div>
          <p className="text-muted-foreground">
            Enter the 6-digit code sent to <span className="font-medium text-foreground">{maskEmail(user?.email || '')}</span>
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          {emailOtp.map((digit, i) => (
            <input
              key={`email-otp-${i}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              autoComplete="off"
              onChange={(e) => {
                const val = e.target.value;
                if (!/^\d*$/.test(val)) return;
                const arr = [...emailOtp];
                arr[i] = val.slice(-1);
                setEmailOtp(arr);
                if (val && i < 5) emailOtpRefs.current[i + 1]?.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !emailOtp[i] && i > 0) emailOtpRefs.current[i - 1]?.focus();
              }}
              ref={(el) => { emailOtpRefs.current[i] = el; }}
              className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-blue-500 focus:outline-none"
            />
          ))}
        </div>
        <div className="flex justify-center mt-4">
          {emailOtpTimer > 0 ? (
            <span className="text-sm text-gray-500">Resend in {emailOtpTimer}s</span>
          ) : (
            <button onClick={sendEmailOtp} disabled={sendingEmailOtp} className="text-sm text-blue-500 hover:underline">
              {sendingEmailOtp ? 'Sending...' : 'Resend Code'}
            </button>
          )}
        </div>
        <button
          onClick={verifyEmailOtp}
          disabled={verifyingEmailOtp || emailOtp.join('').length !== 6}
          className="w-full mt-6 py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {verifyingEmailOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          Verify
        </button>
      </Modal>

      {/* Phone Input Modal */}
      <Modal show={showPhoneInputModal} onClose={() => setShowPhoneInputModal(false)} title="Add Phone Number">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <Smartphone className="w-8 h-8 text-blue-500" />
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
                    <span className="text-gray-500">{country.code}</span>
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
            className="flex-1 px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={handlePhoneSubmit}
          disabled={phoneNumber.length < 10}
          className="w-full mt-6 py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors"
        >
          Continue
        </button>
      </Modal>

      {/* Captcha Modal */}
      <Modal show={showCaptchaModal} onClose={() => setShowCaptchaModal(false)} title="Security Verification">
        <div className="relative h-32 bg-accent rounded-xl mb-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20" />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-12 h-12 bg-blue-500 rounded-lg transition-all"
            style={{ left: `${captchaTarget}%`, marginLeft: '-24px', opacity: 0.5 }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-12 h-12 bg-blue-500 rounded-lg shadow-lg transition-all"
            style={{ left: `${captchaPosition}%`, marginLeft: '-24px' }}
          />
        </div>
        <div 
          className="captcha-slider relative h-12 bg-accent rounded-xl cursor-pointer"
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => { setDragging(false); verifyCaptcha(); }}
          onMouseLeave={() => setDragging(false)}
          onMouseMove={handleCaptchaDrag}
          onTouchStart={() => setDragging(true)}
          onTouchEnd={() => { setDragging(false); verifyCaptcha(); }}
          onTouchMove={handleCaptchaDrag}
        >
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            Drag the slider to match the position
          </div>
          <div
            className="absolute top-1 bottom-1 w-12 bg-blue-500 rounded-lg flex items-center justify-center transition-all"
            style={{ left: `calc(${captchaPosition}% - 24px)` }}
          >
            <ChevronRight className="w-6 h-6 text-white" />
          </div>
        </div>
        {captchaVerified && (
          <div className="mt-4 text-center text-green-500 font-medium flex items-center justify-center gap-2">
            <Check className="w-5 h-5" /> Verified!
          </div>
        )}
      </Modal>

      {/* Phone OTP Modal */}
      <Modal show={showPhoneOtpModal} onClose={() => setShowPhoneOtpModal(false)} title="Phone Verification">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <Smartphone className="w-8 h-8 text-blue-500" />
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
              className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-blue-500 focus:outline-none"
            />
          ))}
        </div>
        <div className="flex justify-center mt-4">
          {phoneOtpTimer > 0 ? (
            <span className="text-sm text-gray-500">Resend in {phoneOtpTimer}s</span>
          ) : (
            <button onClick={sendPhoneOtp} disabled={sendingPhoneOtp} className="text-sm text-blue-500 hover:underline">
              {sendingPhoneOtp ? 'Sending...' : 'Resend Code'}
            </button>
          )}
        </div>
        <button
          onClick={verifyPhoneOtp}
          disabled={verifyingPhoneOtp || phoneOtp.join('').length !== 6}
          className="w-full mt-6 py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {verifyingPhoneOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          Verify & Enable
        </button>
      </Modal>

      {/* Google 2FA Email OTP Modal */}
      <Modal show={showGoogle2faEmailOtpModal} onClose={() => setShowGoogle2faEmailOtpModal(false)} title="Email Verification">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-green-500" />
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
              className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-blue-500 focus:outline-none"
            />
          ))}
        </div>
        <div className="flex justify-center mt-4">
          {google2faEmailOtpTimer > 0 ? (
            <span className="text-sm text-gray-500">Resend in {google2faEmailOtpTimer}s</span>
          ) : (
            <button onClick={sendGoogle2faEmailOtp} disabled={sendingGoogle2faEmailOtp} className="text-sm text-blue-500 hover:underline">
              {sendingGoogle2faEmailOtp ? 'Sending...' : 'Resend Code'}
            </button>
          )}
        </div>
        <button
          onClick={verifyGoogle2faEmailOtp}
          disabled={verifyingGoogle2faEmailOtp || google2faEmailOtp.join('').length !== 6}
          className="w-full mt-6 py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
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
            <p className="text-xs text-gray-500 mb-2">Or enter this key manually:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono text-foreground break-all">{google2faSecret}</code>
              <button
                onClick={() => navigator.clipboard.writeText(google2faSecret)}
                className="p-2 hover:bg-accent rounded-lg"
              >
                <Copy className="w-4 h-4 text-gray-500" />
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
              className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl text-center text-xl font-mono tracking-widest outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={enableGoogle2fa}
            disabled={enablingGoogle2fa || google2faCode.length !== 6}
            className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {enablingGoogle2fa ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Enable 2FA
          </button>
        </div>
      </Modal>

      {/* Disable 2FA Confirm Modal */}
      <Modal show={showDisable2faConfirmModal} onClose={() => setShowDisable2faConfirmModal(false)} title="Disable Google 2FA">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-500" />
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
            className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors"
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
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 pr-12 text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowDisablePassword(!showDisablePassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
              className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl text-center text-xl font-mono tracking-widest outline-none focus:border-blue-500 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={disableGoogle2fa}
            disabled={disabling2fa || !disable2faPassword || disable2faCode.length !== 6}
            className="w-full py-3.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {disabling2fa ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Disable 2FA
          </button>
        </div>
      </Modal>

      {/* Fund Password Modal */}
      <Modal show={showFundPasswordModal} onClose={() => setShowFundPasswordModal(false)} title={hasFundPassword ? 'Change Fund Password' : 'Set Fund Password'}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <KeyRound className="w-8 h-8 text-purple-500" />
          </div>
          <p className="text-muted-foreground">
            Fund password is required for withdrawals and P2P trading
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Fund Password</label>
            <div className="relative">
              <input
                type={showFundPasswordInput ? 'text' : 'password'}
                value={fundPassword}
                onChange={(e) => setFundPassword(e.target.value)}
                placeholder="Enter fund password"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowFundPasswordInput(!showFundPasswordInput)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showFundPasswordInput ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirmFundPasswordInput ? 'text' : 'password'}
                value={confirmFundPassword}
                onChange={(e) => setConfirmFundPassword(e.target.value)}
                placeholder="Confirm fund password"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowConfirmFundPasswordInput(!showConfirmFundPasswordInput)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showConfirmFundPasswordInput ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <button
            onClick={submitFundPassword}
            disabled={settingFundPassword || !fundPassword || fundPassword !== confirmFundPassword}
            className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {settingFundPassword ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {user2faEnabled ? 'Continue' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* Fund Password 2FA Modal */}
      <Modal show={showFundPassword2faModal} onClose={() => setShowFundPassword2faModal(false)} title="Verify 2FA">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-green-500" />
          </div>
          <p className="text-muted-foreground">Enter your Google 2FA code to confirm</p>
        </div>
        <div className="flex gap-3 justify-center">
          {fundPassword2faCode.map((digit, i) => (
            <input
              key={`fund-2fa-${i}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              autoComplete="off"
              onChange={(e) => {
                const val = e.target.value;
                if (!/^\d*$/.test(val)) return;
                const arr = [...fundPassword2faCode];
                arr[i] = val.slice(-1);
                setFundPassword2faCode(arr);
                if (val && i < 5) fundPassword2faRefs.current[i + 1]?.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !fundPassword2faCode[i] && i > 0) fundPassword2faRefs.current[i - 1]?.focus();
              }}
              ref={(el) => { fundPassword2faRefs.current[i] = el; }}
              className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-blue-500 focus:outline-none"
            />
          ))}
        </div>
        <button
          onClick={verifyFundPassword2fa}
          disabled={verifyingFundPassword2fa || fundPassword2faCode.join('').length !== 6}
          className="w-full mt-6 py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {verifyingFundPassword2fa ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          Confirm
        </button>
      </Modal>

      {/* Anti-Phishing Modal */}
      <Modal show={showAntiPhishingModal} onClose={() => setShowAntiPhishingModal(false)} title={isChangingAntiPhishing ? 'Change Anti-Phishing Code' : 'Set Anti-Phishing Code'}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <BadgeCheck className="w-8 h-8 text-blue-500" />
          </div>
          <p className="text-muted-foreground">
            This code will appear in all official emails from Methereum
          </p>
        </div>
        <div className="space-y-4">
          {isChangingAntiPhishing && (
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Current Code</label>
              <input
                type="text"
                value={oldAntiPhishingCodeInput}
                onChange={(e) => setOldAntiPhishingCodeInput(e.target.value)}
                placeholder="Enter current anti-phishing code"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">New Code (4-20 characters)</label>
            <input
              type="text"
              value={antiPhishingCodeInput}
              onChange={(e) => setAntiPhishingCodeInput(e.target.value.slice(0, 20))}
              placeholder="Enter new anti-phishing code"
              className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={saveAntiPhishing}
            disabled={savingAntiPhishing || antiPhishingCodeInput.length < 4}
            className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {savingAntiPhishing ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </Modal>

      {/* Whitelist Verify Modal */}
      <Modal show={showWhitelistVerifyModal} onClose={() => setShowWhitelistVerifyModal(false)} title="Enable Withdrawal Whitelist">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <ShieldCheck className="w-8 h-8 text-orange-500" />
          </div>
          <p className="text-muted-foreground">Verify your identity to enable whitelist</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Email OTP</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={whitelistEmailOtp}
                onChange={(e) => setWhitelistEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit code"
                className="flex-1 px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500"
              />
              <button
                onClick={sendWhitelistOtp}
                disabled={sendingWhitelistOtp || whitelistEmailOtpTimer > 0}
                className="px-4 py-2 bg-accent hover:bg-accent text-foreground/80 rounded-xl transition-colors whitespace-nowrap"
              >
                {whitelistEmailOtpTimer > 0 ? `${whitelistEmailOtpTimer}s` : 'Send'}
              </button>
            </div>
          </div>
          {user2faEnabled && (
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Google 2FA Code</label>
              <input
                type="text"
                value={whitelistGoogle2faCode}
                onChange={(e) => setWhitelistGoogle2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit code"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500"
              />
            </div>
          )}
          <button
            onClick={verifyWhitelistAndEnable}
            disabled={verifyingWhitelist || whitelistEmailOtp.length !== 6 || (user2faEnabled && whitelistGoogle2faCode.length !== 6)}
            className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {verifyingWhitelist ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Enable Whitelist
          </button>
        </div>
      </Modal>

      {/* Address Book Enable Modal */}
      <Modal show={showAddressBookModal} onClose={() => setShowAddressBookModal(false)} title="Enable Address Book Restriction">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
            <BookOpen className="w-8 h-8 text-blue-500" />
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
            className="flex-1 py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
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
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
                  <Mail className="w-8 h-8 text-blue-500" />
                </div>
                <p className="text-muted-foreground">Enter your new email address</p>
              </div>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address"
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 text-foreground"
              />
              <button
                onClick={sendEmailChangeOtp}
                disabled={sendingEmailChangeOtp || !newEmail}
                className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {sendingEmailChangeOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Continue
              </button>
            </>
          )}
          {emailChangeStep === 'verify' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
                  <Mail className="w-8 h-8 text-green-500" />
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
                    className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-blue-500 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex justify-center">
                {emailChangeOtpTimer > 0 ? (
                  <span className="text-sm text-gray-500">Resend in {emailChangeOtpTimer}s</span>
                ) : (
                  <button onClick={sendEmailChangeOtp} disabled={sendingEmailChangeOtp} className="text-sm text-blue-500 hover:underline">
                    {sendingEmailChangeOtp ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
              <button
                onClick={verifyEmailChange}
                disabled={verifyingEmailChange || emailChangeOtp.join('').length !== 6}
                className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
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
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
                  <Smartphone className="w-8 h-8 text-blue-500" />
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
                    className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-blue-500 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex justify-center">
                {smsChangeOtpTimer > 0 ? (
                  <span className="text-sm text-gray-500">Resend in {smsChangeOtpTimer}s</span>
                ) : (
                  <button onClick={sendCurrentPhoneOtp} disabled={sendingSmsChangeOtp} className="text-sm text-blue-500 hover:underline">
                    {sendingSmsChangeOtp ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
              <button
                onClick={verifyCurrentPhoneAndContinue}
                disabled={verifyingSmsChange || currentPhoneOtp.join('').length !== 6}
                className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {verifyingSmsChange ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Verify & Continue
              </button>
            </>
          )}
          {smsChangeStep === 'input_new' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
                  <Smartphone className="w-8 h-8 text-green-500" />
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
                    <ChevronDown className="w-4 h-4 text-gray-400" />
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
                          <span className="text-gray-500 ml-auto">{country.code}</span>
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
                  className="flex-1 px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 text-foreground"
                />
              </div>
              <button
                onClick={sendNewPhoneOtp}
                disabled={sendingSmsChangeOtp || !newPhoneNumber}
                className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {sendingSmsChangeOtp ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Continue
              </button>
            </>
          )}
          {smsChangeStep === 'verify_new' && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
                  <Smartphone className="w-8 h-8 text-green-500" />
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
                    className="w-12 h-14 text-center text-xl font-bold text-foreground bg-muted border-2 border-border rounded-xl focus:border-blue-500 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex justify-center">
                {smsChangeOtpTimer > 0 ? (
                  <span className="text-sm text-gray-500">Resend in {smsChangeOtpTimer}s</span>
                ) : (
                  <button onClick={sendNewPhoneOtp} disabled={sendingSmsChangeOtp} className="text-sm text-blue-500 hover:underline">
                    {sendingSmsChangeOtp ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
              <button
                onClick={verifyNewPhoneAndSave}
                disabled={verifyingSmsChange || newPhoneOtp.join('').length !== 6}
                className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
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
            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full mx-auto flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-purple-500" />
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
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 text-foreground pr-12"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 text-foreground pr-12"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
                className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl outline-none focus:border-blue-500 text-foreground pr-12"
              />
              <button
                type="button"
                onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showConfirmNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <button
            onClick={changePassword}
            disabled={changingPassword || !currentPassword || !newPassword || newPassword !== confirmNewPassword}
            className="w-full py-3.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
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
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl mx-auto flex items-center justify-center mb-4 shadow-lg">
              <Fingerprint className="w-10 h-10 text-white" />
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
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg"
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
                  className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                      <Check className="w-6 h-6 text-green-600" />
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
                    className="px-3 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-sm font-medium"
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
                className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 text-muted-foreground font-medium rounded-xl hover:border-blue-500 hover:text-blue-500 transition-all flex items-center justify-center gap-2"
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
