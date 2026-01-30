'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
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
} from 'lucide-react';

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

export default function SecurityPage() {
  const { user, accessToken } = useAuthStore();
  const [withdrawalWhitelist, setWithdrawalWhitelist] = useState(false);
  const [withdrawViaAddressBook, setWithdrawViaAddressBook] = useState(false);
  const [newAddressLock, setNewAddressLock] = useState(false);
  
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  
  // Refs for OTP inputs
  const emailOtpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const phoneOtpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Fetch user phone, 2FA status, and passkeys
  useEffect(() => {
    const fetchUserData = async () => {
      if (!accessToken) return;
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
      } catch (error) {
        console.error('Failed to fetch user data:', error);
      } finally {
        setLoadingPhone(false);
        setLoadingGoogle2fa(false);
        setLoadingPasskeys(false);
        setLoadingFundPassword(false);
      }
    };
    fetchUserData();
  }, [accessToken]);

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

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '***';
    const maskedDomain = '****';
    return `${maskedLocal}@${maskedDomain}`;
  };

  const maskPhone = (phone: string) => {
    if (!phone) return '';
    return phone.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2');
  };

  // Start SMS Setup Flow
  const handleSmsSettingsClick = () => {
    setShowEmailOtpModal(true);
    sendEmailOtp();
  };

  // Send Email OTP
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
        alert(result.error?.message || 'Failed to send OTP');
      }
    } catch (error) {
      console.error('Failed to send email OTP:', error);
      alert('Failed to send OTP');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  // Verify Email OTP
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
        alert(result.error?.message || 'Invalid OTP');
      }
    } catch (error) {
      console.error('Failed to verify email OTP:', error);
      alert('Failed to verify OTP');
    } finally {
      setVerifyingEmailOtp(false);
    }
  };

  // Handle Phone Input Submit
  const handlePhoneSubmit = () => {
    if (phoneNumber.length < 10) {
      alert('Please enter a valid phone number');
      return;
    }
    setShowPhoneInputModal(false);
    setShowCaptchaModal(true);
    setCaptchaPosition(0);
    setCaptchaVerified(false);
    setCaptchaTarget(Math.floor(Math.random() * 40) + 50); // Random target between 50-90%
  };

  // Handle Captcha Drag
  const handleCaptchaDrag = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    const slider = (e.target as HTMLElement).closest('.captcha-slider');
    if (!slider) return;
    
    const rect = slider.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const position = ((clientX - rect.left) / rect.width) * 100;
    setCaptchaPosition(Math.max(0, Math.min(100, position)));
  };

  // Verify Captcha
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
      alert('Please complete the puzzle correctly');
    }
  };

  // Send Phone OTP
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
        alert(result.error?.message || 'Failed to send OTP');
      }
    } catch (error) {
      console.error('Failed to send phone OTP:', error);
      alert('Failed to send OTP');
    } finally {
      setSendingPhoneOtp(false);
    }
  };

  // Verify Phone OTP and Save
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
        alert('Phone number verified successfully!');
      } else {
        alert(result.error?.message || 'Invalid OTP');
      }
    } catch (error) {
      console.error('Failed to verify phone OTP:', error);
      alert('Failed to verify OTP');
    } finally {
      setVerifyingPhoneOtp(false);
    }
  };

  // Handle OTP Input
  const handleOtpInput = (
    index: number,
    value: string,
    otpArray: string[],
    setOtpArray: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otpArray];
    newOtp[index] = value.slice(-1);
    setOtpArray(newOtp);
    
    if (value && index < 5) {
      refs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent,
    otpArray: string[],
    setOtpArray: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => {
    if (e.key === 'Backspace' && !otpArray[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (
    e: React.ClipboardEvent,
    setOtpArray: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newOtp = pastedData.split('').concat(Array(6).fill('')).slice(0, 6);
    setOtpArray(newOtp);
    if (pastedData.length === 6) {
      refs.current[5]?.focus();
    } else {
      refs.current[pastedData.length]?.focus();
    }
  };

  // Close all modals
  // ========== GOOGLE 2FA FUNCTIONS ==========

  // Start Google 2FA Setup Flow
  const handleGoogle2faSettingsClick = () => {
    setShowGoogle2faEmailOtpModal(true);
    sendGoogle2faEmailOtp();
  };

  // Send Email OTP for Google 2FA
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
        alert(result.error?.message || 'Failed to send OTP');
      }
    } catch (error) {
      console.error('Failed to send email OTP:', error);
      alert('Failed to send OTP');
    } finally {
      setSendingGoogle2faEmailOtp(false);
    }
  };

  // Verify Email OTP and get 2FA secret
  const verifyGoogle2faEmailOtp = async () => {
    const otp = google2faEmailOtp.join('');
    if (otp.length !== 6) return;
    
    setVerifyingGoogle2faEmailOtp(true);
    try {
      // First verify email OTP
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
        alert(verifyResult.error?.message || 'Invalid OTP');
        return;
      }

      // Then generate 2FA secret
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
        alert(setupResult.error?.message || 'Failed to setup 2FA');
      }
    } catch (error) {
      console.error('Failed to verify email OTP:', error);
      alert('Failed to verify OTP');
    } finally {
      setVerifyingGoogle2faEmailOtp(false);
    }
  };

  // Enable Google 2FA
  const enableGoogle2fa = async () => {
    if (!google2faCode || google2faCode.length !== 6) {
      alert('Please enter a valid 6-digit code');
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
        alert('Google 2FA enabled successfully!');
      } else {
        alert(result.error?.message || 'Invalid code. Please try again.');
      }
    } catch (error) {
      console.error('Failed to enable 2FA:', error);
      alert('Failed to enable 2FA');
    } finally {
      setEnablingGoogle2fa(false);
    }
  };

  // Copy secret to clipboard
  const copySecretToClipboard = () => {
    navigator.clipboard.writeText(google2faSecret);
    alert('Secret key copied to clipboard!');
  };

  // ========== DISABLE 2FA FUNCTIONS ==========

  // Handle Disable 2FA button click
  const handleDisable2faClick = () => {
    setShowDisable2faConfirmModal(true);
  };

  // Handle Remove button in confirmation modal
  const handleDisable2faRemove = () => {
    setShowDisable2faConfirmModal(false);
    setShowDisable2faVerifyModal(true);
  };

  // Handle Disable 2FA verification
  const verifyAndDisable2fa = async () => {
    if (!disable2faPassword || !disable2faCode) {
      alert('Please enter both password and 2FA code');
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
        body: JSON.stringify({ 
          password: disable2faPassword, 
          code: disable2faCode 
        }),
      });
      const result = await response.json();
      
      if (result.success) {
        setUser2faEnabled(false);
        setShowDisable2faVerifyModal(false);
        setDisable2faPassword('');
        setDisable2faCode('');
        alert('Google 2FA has been disabled successfully!');
      } else {
        alert(result.error?.message || 'Failed to disable 2FA. Please check your password and code.');
      }
    } catch (error) {
      console.error('Failed to disable 2FA:', error);
      alert('Failed to disable 2FA');
    } finally {
      setDisabling2fa(false);
    }
  };

  const closeAllModals = () => {
    setShowEmailOtpModal(false);
    setShowPhoneInputModal(false);
    setShowCaptchaModal(false);
    setShowPhoneOtpModal(false);
    setShowGoogle2faEmailOtpModal(false);
    setShowGoogle2faSetupModal(false);
    setShowDisable2faConfirmModal(false);
    setShowDisable2faVerifyModal(false);
    setShowFundPasswordModal(false);
    setShowFundPassword2faModal(false);
    setEmailOtp(['', '', '', '', '', '']);
    setPhoneOtp(['', '', '', '', '', '']);
    setGoogle2faEmailOtp(['', '', '', '', '', '']);
    setPhoneNumber('');
    setCaptchaPosition(0);
    setGoogle2faCode('');
    setDisable2faPassword('');
    setDisable2faCode('');
    setFundPassword('');
    setConfirmFundPassword('');
    setFundPassword2faCode(['', '', '', '', '', '']);
  };

  // ========== FUND PASSWORD FUNCTIONS ==========

  // Fund password validation
  const validateFundPassword = (password: string) => {
    const hasMinLength = password.length >= 8 && password.length <= 30;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return { hasMinLength, hasUppercase, hasLowercase, hasNumber, isValid: hasMinLength && hasUppercase && hasLowercase && hasNumber };
  };

  // Handle Fund Password Settings click
  const handleFundPasswordClick = () => {
    setShowFundPasswordModal(true);
  };

  // Handle Fund Password submit (first step)
  const handleFundPasswordSubmit = async () => {
    const validation = validateFundPassword(fundPassword);
    if (!validation.isValid) {
      alert('Please ensure your password meets all requirements');
      return;
    }

    if (fundPassword !== confirmFundPassword) {
      alert('Passwords do not match');
      return;
    }

    setSettingFundPassword(true);
    try {
      // Check if fund password is same as login password
      const checkRes = await fetch(`${apiUrl}/api/v1/auth/fund-password/check-same`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password: fundPassword }),
      });
      const checkResult = await checkRes.json();

      if (checkResult.data?.isSame) {
        alert('Fund password must be different from your login password. Please choose a different password.');
        setSettingFundPassword(false);
        return;
      }

      // If 2FA is enabled, show 2FA verification
      if (user2faEnabled) {
        setShowFundPasswordModal(false);
        setShowFundPassword2faModal(true);
      } else {
        // If no 2FA, directly set fund password
        await saveFundPassword();
      }
    } catch (error) {
      console.error('Error checking fund password:', error);
      alert('Failed to process fund password');
    } finally {
      setSettingFundPassword(false);
    }
  };

  // Verify 2FA and save fund password
  const verifyAndSaveFundPassword = async () => {
    const code = fundPassword2faCode.join('');
    if (code.length !== 6) return;

    setVerifyingFundPassword2fa(true);
    try {
      const verifyRes = await fetch(`${apiUrl}/api/v1/auth/2fa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ code }),
      });
      const verifyResult = await verifyRes.json();

      if (!verifyResult.success) {
        alert(verifyResult.error?.message || 'Invalid 2FA code');
        setVerifyingFundPassword2fa(false);
        return;
      }

      await saveFundPassword();
    } catch (error) {
      console.error('Failed to verify 2FA:', error);
      alert('Verification failed');
    } finally {
      setVerifyingFundPassword2fa(false);
    }
  };

  // Save fund password
  const saveFundPassword = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/fund-password/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password: fundPassword }),
      });
      const result = await response.json();

      if (result.success) {
        setHasFundPassword(true);
        closeAllModals();
        alert('Fund password set successfully!');
      } else {
        alert(result.error?.message || 'Failed to set fund password');
      }
    } catch (error) {
      console.error('Failed to set fund password:', error);
      alert('Failed to set fund password');
    }
  };

  // Handle fund password 2FA input
  const handleFundPassword2faInput = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...fundPassword2faCode];
    newCode[index] = value.slice(-1);
    setFundPassword2faCode(newCode);
    
    if (value && index < 5) {
      fundPassword2faRefs.current[index + 1]?.focus();
    }
  };

  const handleFundPassword2faKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !fundPassword2faCode[index] && index > 0) {
      fundPassword2faRefs.current[index - 1]?.focus();
    }
  };

  const handleFundPassword2faPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newCode = [...fundPassword2faCode];
    for (let i = 0; i < pastedData.length; i++) {
      newCode[i] = pastedData[i];
    }
    setFundPassword2faCode(newCode);
  };

  const fundPasswordValidation = validateFundPassword(fundPassword);

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      {/* Page Title */}
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        Security
      </h1>

      {/* Two-Factor Authentication */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Two-Factor Authentication</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Login Password */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Lock className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Login Password</h3>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-green-500">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Settings
              </span>
              <Link
                href="/dashboard/security/change-password"
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Change
              </Link>
            </div>
          </div>

          {/* Email Authentication */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Mail className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Email Authentication</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  For Login, withdraw, password retrieval, security settings change and API management verification.{' '}
                  <span className="text-blue-500 hover:underline cursor-pointer">Unlink</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-green-500">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                {maskEmail(user?.email || '')} <span className="text-gray-400">⊘</span>
              </span>
              <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
                Change Email
              </button>
            </div>
          </div>

          {/* SMS Authentication */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">SMS Authentication</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  For login, password reset, and change of security settings
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {loadingPhone ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              ) : userPhone ? (
                <>
                  <span className="flex items-center gap-1 text-sm text-green-500">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    {maskPhone(userPhone)}
                  </span>
                  <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
                    Change
                  </button>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-sm text-gray-400">
                    <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                    Not Yet Configured
                  </span>
                  <button 
                    onClick={handleSmsSettingsClick}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                  >
                    Settings
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Google Two Factor Authentication */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Shield className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Google Two Factor Authentication</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  For login, withdrawal, password reset, change of security settings, and API management verification
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {loadingGoogle2fa ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              ) : user2faEnabled ? (
                <>
                  <span className="flex items-center gap-1 text-sm text-green-500">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    Settings
                  </span>
                  <button 
                    onClick={handleDisable2faClick}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    Disable
                  </button>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-sm text-gray-400">
                    <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                    Not Yet Configured
                  </span>
                  <button 
                    onClick={handleGoogle2faSettingsClick}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                  >
                    Settings
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Protection */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Advanced Protection</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Passkeys */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Key className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Passkeys</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Use passkeys to protect your account and authorize withdrawals.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {loadingPasskeys ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              ) : passkeysCount > 0 ? (
                <>
                  <span className="flex items-center gap-1 text-sm text-green-500">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    Set up
                  </span>
                  <Link 
                    href="/dashboard/security/passkeys"
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    Settings
                  </Link>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-sm text-gray-400">
                    <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                    Not Yet Configured
                  </span>
                  <Link 
                    href="/dashboard/security/passkeys"
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                  >
                    Settings
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Secure Transaction Approval */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Phone className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Secure Transaction Approval</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Add a primary phone for verification in withdrawals and other services.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-gray-400">
                <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                Not Yet Configured
              </span>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center cursor-pointer">
                  <span className="text-white text-xs">?</span>
                </div>
                <button className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors">
                  Settings
                </button>
              </div>
            </div>
          </div>

          {/* Fund Password */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Fund Password</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Used during withdrawal, P2P trading, and other scenarios to conduct security verification.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {loadingFundPassword ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              ) : hasFundPassword ? (
                <>
                  <span className="flex items-center gap-1 text-sm text-green-500">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    Set up
                  </span>
                  <button 
                    onClick={handleFundPasswordClick}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    Change
                  </button>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-sm text-gray-400">
                    <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                    Not Yet Configured
                  </span>
                  <button 
                    onClick={handleFundPasswordClick}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                  >
                    Settings
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Anti-phishing Code */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Anti-phishing Code</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  After you've successfully set up the anti-phishing code, it will appear in all official emails from Methereum to prevent phishing attempts.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-gray-400">
                <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                Not Yet Configured
              </span>
              <button className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors">
                Settings
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Withdrawal Security */}
      <div className="bg-white dark:bg-[#181a20] rounded-xl mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Withdrawal Security</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {/* Withdrawal Address Whitelist */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Wallet className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Withdrawal Address Whitelist</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  When this feature is enabled, you will not need Google two-factor authentication or email verification for withdrawals to trusted addresses. However, if unusual activity is detected, security verification will still be enforced.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-gray-400">
                <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                Not Enabled Yet
              </span>
              <button
                onClick={() => setWithdrawalWhitelist(!withdrawalWhitelist)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  withdrawalWhitelist ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow ${
                    withdrawalWhitelist ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Withdraw via Address Book */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Withdraw via Address Book</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Once enabled, you can only withdraw to addresses saved in your Address Book.{' '}
                  <span className="text-blue-500 hover:underline cursor-pointer">Manage Withdrawal Addresses</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-gray-400">
                <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                Not Enabled Yet
              </span>
              <button
                onClick={() => setWithdrawViaAddressBook(!withdrawViaAddressBook)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  withdrawViaAddressBook ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow ${
                    withdrawViaAddressBook ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* New Address Withdrawal Lock */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <MapPin className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <h3 className="font-medium text-gray-400">New Address Withdrawal Lock</h3>
                <p className="text-sm text-gray-400">
                  Once enabled, the withdrawal function will be disabled to newly saved addresses for 24 hours.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-sm text-gray-400">
                <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                Not Enabled Yet
              </span>
              <button
                onClick={() => setNewAddressLock(!newAddressLock)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  newAddressLock ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow ${
                    newAddressLock ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Manage Crypto Withdrawal Limits */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Coins className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">Manage Crypto Withdrawal Limits</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Daily Withdrawal Amount: 20000 USDT,Monthly Withdrawal Amount: 100000 USDT
                </p>
              </div>
            </div>
            <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-800">
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
              {['facebook', 'twitter', 'instagram', 'youtube', 'linkedin', 'telegram', 'tiktok', 'reddit', 'discord'].map((social) => (
                <div
                  key={social}
                  className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <span className="text-xs text-gray-500">●</span>
                </div>
              ))}
            </div>
          </div>

          {/* About */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">About</h3>
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
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Services</h3>
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
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Support</h3>
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
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Products</h3>
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
        <div className="pt-6 border-t border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <span>© 2018-2026 Methereum.com. All rights reserved.</span>
          <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white">Privacy Terms</Link>
        </div>
      </footer>

      {/* ========== MODALS ========== */}

      {/* Email OTP Modal */}
      {showEmailOtpModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Security Verification</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-6">
                <Mail className="w-4 h-4" />
                <span>A verification code will be sent to <strong className="text-gray-900 dark:text-white">{maskEmail(user?.email || '')}</strong></span>
              </div>

              {/* OTP Inputs */}
              <div className="flex justify-center gap-2 mb-4">
                {emailOtp.map((digit, index) => (
                  <input
                    key={index}
                    ref={el => { emailOtpRefs.current[index] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpInput(index, e.target.value, emailOtp, setEmailOtp, emailOtpRefs)}
                    onKeyDown={e => handleOtpKeyDown(index, e, emailOtp, setEmailOtp, emailOtpRefs)}
                    onPaste={e => handleOtpPaste(e, setEmailOtp, emailOtpRefs)}
                    className="w-12 h-14 text-center text-xl font-semibold border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                  />
                ))}
              </div>

              <div className="text-center mb-6">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Not able to receive verification code?{' '}
                  {emailOtpTimer > 0 ? (
                    <span className="text-gray-400">{emailOtpTimer}s</span>
                  ) : (
                    <button 
                      onClick={sendEmailOtp} 
                      disabled={sendingEmailOtp}
                      className="text-blue-500 hover:underline"
                    >
                      {sendingEmailOtp ? 'Sending...' : 'Resend'}
                    </button>
                  )}
                </span>
              </div>

              <p className="text-center text-sm text-blue-500 hover:underline cursor-pointer mb-6">
                Having problems with verification?
              </p>

              <button
                onClick={verifyEmailOtp}
                disabled={verifyingEmailOtp || emailOtp.join('').length !== 6}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {verifyingEmailOtp ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phone Input Modal */}
      {showPhoneInputModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Set mobile phone number</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Country Selector */}
              <div className="mb-4">
                <label className="block text-sm text-gray-500 dark:text-gray-400 mb-2">Country or region</label>
                <div className="relative">
                  <button
                    onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-left flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2 text-gray-900 dark:text-white">
                      <span>{selectedCountry.flag}</span>
                      <span>{selectedCountry.code} {selectedCountry.name}</span>
                    </span>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>

                  {showCountryDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                      {countries.map(country => (
                        <button
                          key={country.code}
                          onClick={() => {
                            setSelectedCountry(country);
                            setShowCountryDropdown(false);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center gap-2 text-gray-900 dark:text-white"
                        >
                          <span>{country.flag}</span>
                          <span>{country.code} {country.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Phone Input */}
              <div className="mb-6">
                <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
                  <input type="checkbox" className="rounded" defaultChecked />
                  Enter a new mobile phone number
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={phoneNumber}
                  onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="Enter phone number"
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>

              <button
                onClick={handlePhoneSubmit}
                disabled={phoneNumber.length < 10}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Captcha Modal */}
      {showCaptchaModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            {/* Image with puzzle piece */}
            <div className="relative h-48 bg-gradient-to-br from-blue-600 to-blue-800 overflow-hidden">
              <img
                src="/assets/captcha-bg.jpg"
                alt="Captcha"
                className="w-full h-full object-cover opacity-80"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 bg-white/20 rounded-lg mb-2 mx-auto flex items-center justify-center">
                    <span className="text-white font-bold text-2xl">M</span>
                  </div>
                  <span className="text-white font-semibold">METHEREUM</span>
                </div>
              </div>
              {/* Puzzle piece indicator */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-10 h-10 border-2 border-white/50 rounded-lg bg-white/10"
                style={{ left: `${captchaTarget}%`, transform: `translateX(-50%) translateY(-50%)` }}
              />
              {/* Moving puzzle piece */}
              <div 
                className={`absolute top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg transition-colors ${
                  captchaVerified ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ left: `${captchaPosition}%`, transform: `translateX(-50%) translateY(-50%)` }}
              />
            </div>

            {/* Slider */}
            <div className="p-4">
              <div 
                className="captcha-slider relative h-12 bg-gray-100 dark:bg-gray-700 rounded-lg cursor-pointer"
                onMouseDown={() => setDragging(true)}
                onMouseUp={() => {
                  setDragging(false);
                  verifyCaptcha();
                }}
                onMouseLeave={() => {
                  if (dragging) {
                    setDragging(false);
                    verifyCaptcha();
                  }
                }}
                onMouseMove={handleCaptchaDrag}
                onTouchStart={() => setDragging(true)}
                onTouchEnd={() => {
                  setDragging(false);
                  verifyCaptcha();
                }}
                onTouchMove={handleCaptchaDrag}
              >
                <div 
                  className={`absolute top-1 bottom-1 left-1 w-10 rounded-md flex items-center justify-center transition-colors ${
                    captchaVerified ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                  style={{ left: `calc(${captchaPosition}% - ${captchaPosition * 0.4}px)` }}
                >
                  {captchaVerified ? (
                    <Check className="w-5 h-5 text-white" />
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <div className="w-4 h-0.5 bg-white rounded"></div>
                      <div className="w-4 h-0.5 bg-white rounded"></div>
                      <div className="w-4 h-0.5 bg-white rounded"></div>
                    </div>
                  )}
                </div>
                <span className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 pointer-events-none">
                  {captchaVerified ? 'Verified!' : 'Slide to complete the puzzle'}
                </span>
              </div>

              <button 
                onClick={closeAllModals}
                className="mt-4 w-full flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-4 h-4" />
                <span className="text-sm">Close</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phone OTP Modal */}
      {showPhoneOtpModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Set mobile phone number</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-6">
                <input type="checkbox" className="rounded" defaultChecked />
                <span>A verification code will be sent to <strong className="text-gray-900 dark:text-white">{selectedCountry.code}{phoneNumber}</strong></span>
              </div>

              {/* OTP Inputs */}
              <div className="flex justify-center gap-2 mb-4">
                {phoneOtp.map((digit, index) => (
                  <input
                    key={index}
                    ref={el => { phoneOtpRefs.current[index] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpInput(index, e.target.value, phoneOtp, setPhoneOtp, phoneOtpRefs)}
                    onKeyDown={e => handleOtpKeyDown(index, e, phoneOtp, setPhoneOtp, phoneOtpRefs)}
                    onPaste={e => handleOtpPaste(e, setPhoneOtp, phoneOtpRefs)}
                    className="w-12 h-14 text-center text-xl font-semibold border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                  />
                ))}
              </div>

              <div className="text-center mb-6">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Not able to receive verification code?{' '}
                  {phoneOtpTimer > 0 ? (
                    <span className="text-gray-400">{phoneOtpTimer}s</span>
                  ) : (
                    <button 
                      onClick={sendPhoneOtp} 
                      disabled={sendingPhoneOtp}
                      className="text-blue-500 hover:underline"
                    >
                      {sendingPhoneOtp ? 'Sending...' : 'Resend'}
                    </button>
                  )}
                </span>
              </div>

              <button
                onClick={verifyPhoneOtp}
                disabled={verifyingPhoneOtp || phoneOtp.join('').length !== 6}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {verifyingPhoneOtp ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google 2FA Email OTP Modal */}
      {showGoogle2faEmailOtpModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Security Verification</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-6">
                <Mail className="w-4 h-4" />
                <span>A verification code will be sent to <strong className="text-gray-900 dark:text-white">{maskEmail(user?.email || '')}</strong></span>
              </div>

              {/* OTP Inputs */}
              <div className="flex justify-center gap-2 mb-4">
                {google2faEmailOtp.map((digit, index) => (
                  <input
                    key={index}
                    ref={el => { google2faEmailOtpRefs.current[index] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpInput(index, e.target.value, google2faEmailOtp, setGoogle2faEmailOtp, google2faEmailOtpRefs)}
                    onKeyDown={e => handleOtpKeyDown(index, e, google2faEmailOtp, setGoogle2faEmailOtp, google2faEmailOtpRefs)}
                    onPaste={e => handleOtpPaste(e, setGoogle2faEmailOtp, google2faEmailOtpRefs)}
                    className="w-12 h-14 text-center text-xl font-semibold border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                  />
                ))}
              </div>

              <div className="text-center mb-6">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Not able to receive verification code?{' '}
                  {google2faEmailOtpTimer > 0 ? (
                    <span className="text-gray-400">{google2faEmailOtpTimer}s</span>
                  ) : (
                    <button 
                      onClick={sendGoogle2faEmailOtp} 
                      disabled={sendingGoogle2faEmailOtp}
                      className="text-blue-500 hover:underline"
                    >
                      {sendingGoogle2faEmailOtp ? 'Sending...' : 'Resend'}
                    </button>
                  )}
                </span>
              </div>

              <p className="text-center text-sm text-blue-500 hover:underline cursor-pointer mb-6">
                Having problems with verification?
              </p>

              <button
                onClick={verifyGoogle2faEmailOtp}
                disabled={verifyingGoogle2faEmailOtp || google2faEmailOtp.join('').length !== 6}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {verifyingGoogle2faEmailOtp ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google 2FA Setup Modal */}
      {showGoogle2faSetupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Set Up Google Two-Factor Authentication</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Step 1 */}
              <div className="mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium flex-shrink-0">
                    1
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-1">Download Google Authenticator Android / iOS</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Google Authenticator can be downloaded from the App Store or Google Play.
                      Search "Google Authenticator" and proceed to download.
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium flex-shrink-0">
                    2
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-1">Add key phrase into Google Authenticator and remember the key phrase</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      Open Google Authenticator, scan the QR code below or manually enter the key phrase to activate the verification token
                    </p>
                    <p className="text-sm text-orange-500 mb-4">
                      Key phrase is used to recover Google Authenticator in the event of a loss or change of device — please make sure to keep the key phrase safe before setting up Google Authenticator.
                    </p>

                    {/* 2FA Code Input */}
                    <div className="mb-4">
                      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                        <Shield className="w-4 h-4" />
                        Google 2FA Code
                      </label>
                      <input
                        type="text"
                        value={google2faCode}
                        onChange={e => setGoogle2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Please enter the Google Authenticator code"
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                      />
                    </div>

                    {/* QR Code */}
                    <div className="flex justify-center mb-4">
                      {google2faQrCode ? (
                        <img 
                          src={google2faQrCode} 
                          alt="QR Code" 
                          className="w-40 h-40 border border-gray-200 dark:border-gray-600 rounded-lg"
                        />
                      ) : (
                        <div className="w-40 h-40 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                        </div>
                      )}
                    </div>

                    {/* Copy Key */}
                    <div className="mb-6">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Copy key</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded text-sm font-mono text-gray-900 dark:text-white break-all">
                          {google2faSecret}
                        </code>
                        <button
                          onClick={copySecretToClipboard}
                          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                          title="Copy to clipboard"
                        >
                          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={enableGoogle2fa}
                  disabled={enablingGoogle2fa || google2faCode.length !== 6}
                  className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {enablingGoogle2fa ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    'Confirm'
                  )}
                </button>
                <button
                  onClick={closeAllModals}
                  className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-white font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disable 2FA Confirmation Modal */}
      {showDisable2faConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              {/* Close Button */}
              <div className="flex justify-end mb-4">
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Warning Icon */}
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-4">
                Confirm Removing Google 2FA Authentication?
              </h2>

              {/* Note */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-6">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Note:</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  For account security, please be aware that after unlinking Google two-factor authentication, 
                  on-chain withdrawals, internal transfers, fiat withdrawals, Card transactions, P2P Trading, 
                  and advertising will be suspended for 24 hours.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleDisable2faRemove}
                  className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
                >
                  Remove
                </button>
                <button
                  onClick={closeAllModals}
                  className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-white font-medium rounded-lg transition-colors border border-gray-200 dark:border-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disable 2FA Verification Modal */}
      {showDisable2faVerifyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Security Verification</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Login Password */}
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                  <Lock className="w-4 h-4" />
                  Login Password
                </label>
                <div className="relative">
                  <input
                    type={showDisablePassword ? 'text' : 'password'}
                    value={disable2faPassword}
                    onChange={e => setDisable2faPassword(e.target.value)}
                    placeholder="Please enter a password"
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDisablePassword(!showDisablePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showDisablePassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Google 2FA Code */}
              <div className="mb-6">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                  <Shield className="w-4 h-4" />
                  Google 2FA Code
                </label>
                <input
                  type="text"
                  value={disable2faCode}
                  onChange={e => setDisable2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Please enter the Google Authenticator code"
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>

              {/* Next Step Button */}
              <button
                onClick={verifyAndDisable2fa}
                disabled={disabling2fa || !disable2faPassword || disable2faCode.length !== 6}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {disabling2fa ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Next Step'
                )}
              </button>

              {/* Help Link */}
              <p className="text-center text-sm text-blue-500 hover:underline cursor-pointer mt-4">
                Having problems with verification?
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fund Password Modal */}
      {showFundPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {hasFundPassword ? 'Change Fund Password' : 'Link Fund Password'}
                </h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Fund Password Input */}
              <div className="mb-4">
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-2 block">Fund Password</label>
                <div className="relative">
                  <input
                    type={showFundPasswordInput ? 'text' : 'password'}
                    value={fundPassword}
                    onChange={e => setFundPassword(e.target.value)}
                    placeholder="Enter fund password"
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none pr-20"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    {fundPassword && (
                      <button
                        type="button"
                        onClick={() => setFundPassword('')}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowFundPasswordInput(!showFundPasswordInput)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {showFundPasswordInput ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                {/* Password Requirements */}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Password must contain 8-30 characters, including at least one uppercase letter, one lowercase letter and a number.
                </p>
                {/* Validation indicators */}
                {fundPassword && (
                  <div className="mt-2 space-y-1">
                    <p className={`text-xs flex items-center gap-1 ${fundPasswordValidation.hasMinLength ? 'text-green-500' : 'text-red-500'}`}>
                      {fundPasswordValidation.hasMinLength ? '✓' : '✗'} 8-30 characters
                    </p>
                    <p className={`text-xs flex items-center gap-1 ${fundPasswordValidation.hasUppercase ? 'text-green-500' : 'text-red-500'}`}>
                      {fundPasswordValidation.hasUppercase ? '✓' : '✗'} One uppercase letter
                    </p>
                    <p className={`text-xs flex items-center gap-1 ${fundPasswordValidation.hasLowercase ? 'text-green-500' : 'text-red-500'}`}>
                      {fundPasswordValidation.hasLowercase ? '✓' : '✗'} One lowercase letter
                    </p>
                    <p className={`text-xs flex items-center gap-1 ${fundPasswordValidation.hasNumber ? 'text-green-500' : 'text-red-500'}`}>
                      {fundPasswordValidation.hasNumber ? '✓' : '✗'} One number
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm Fund Password Input */}
              <div className="mb-6">
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-2 block">Confirm Fund Password</label>
                <div className="relative">
                  <input
                    type={showConfirmFundPasswordInput ? 'text' : 'password'}
                    value={confirmFundPassword}
                    onChange={e => setConfirmFundPassword(e.target.value)}
                    placeholder="Please Enter"
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmFundPasswordInput(!showConfirmFundPasswordInput)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmFundPasswordInput ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    )}
                  </button>
                </div>
                {confirmFundPassword && fundPassword !== confirmFundPassword && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>

              {/* Confirm Button */}
              <button
                onClick={handleFundPasswordSubmit}
                disabled={settingFundPassword || !fundPasswordValidation.isValid || fundPassword !== confirmFundPassword}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {settingFundPassword ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fund Password 2FA Verification Modal */}
      {showFundPassword2faModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Security Verification</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Google 2FA Code */}
              <div className="mb-6">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                  <Shield className="w-4 h-4" />
                  Google 2FA Code
                </label>
                <div className="flex justify-center gap-2">
                  {fundPassword2faCode.map((digit, index) => (
                    <input
                      key={index}
                      ref={el => { fundPassword2faRefs.current[index] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleFundPassword2faInput(index, e.target.value)}
                      onKeyDown={e => handleFundPassword2faKeyDown(index, e)}
                      onPaste={handleFundPassword2faPaste}
                      className="w-12 h-14 text-center text-xl font-semibold border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                    />
                  ))}
                </div>
              </div>

              {/* Help Link */}
              <p className="text-center text-sm text-blue-500 hover:underline cursor-pointer mb-6">
                Having problems with verification?
              </p>

              {/* Confirm Button */}
              <button
                onClick={verifyAndSaveFundPassword}
                disabled={verifyingFundPassword2fa || fundPassword2faCode.join('').length !== 6}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {verifyingFundPassword2fa ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
