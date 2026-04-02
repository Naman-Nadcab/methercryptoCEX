'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Lock,
  Monitor,
  ShieldCheck,
  X,
  Loader2,
  Shield,
  Mail,
  KeyRound,
  Edit3,
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';

interface Passkey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export default function PasskeysPage() {
  const router = useRouter();
  const { user, accessToken } = useAuthStore();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyCode, setVerifyCode] = useState(['', '', '', '', '', '']);
  const [verifying, setVerifying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [user2faEnabled, setUser2faEnabled] = useState(false);
  const verifyCodeRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Rename states
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamePasskeyId, setRenamePasskeyId] = useState('');
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Delete states
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showDeleteVerifyModal, setShowDeleteVerifyModal] = useState(false);
  const [deletePasskeyId, setDeletePasskeyId] = useState('');
  const [deleteEmailOtp, setDeleteEmailOtp] = useState('');
  const [delete2faCode, setDelete2faCode] = useState('');
  const [deleteEmailOtpTimer, setDeleteEmailOtpTimer] = useState(0);
  const [sendingDeleteEmailOtp, setSendingDeleteEmailOtp] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const apiUrl = getApiBaseUrl();

  // Fetch passkeys and 2FA status
  useEffect(() => {
    const fetchData = async () => {
      if (!accessToken) return;
      try {
        // Fetch profile to check 2FA status
        const profileRes = await fetch(`${apiUrl}/api/v1/auth/profile`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const profileResult = await profileRes.json();
        if (profileResult.success) {
          setUser2faEnabled(profileResult.data.user?.totp_enabled || false);
        }

        // Fetch passkeys
        const passkeysRes = await fetch(`${apiUrl}/api/v1/auth/passkeys`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const passkeysResult = await passkeysRes.json();
        if (passkeysResult.success) {
          setPasskeys(passkeysResult.data.passkeys || []);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [accessToken]);

  // Timer for delete email OTP
  useEffect(() => {
    if (deleteEmailOtpTimer > 0) {
      const timer = setTimeout(() => setDeleteEmailOtpTimer(deleteEmailOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [deleteEmailOtpTimer]);

  // Handle OTP input
  const handleOtpInput = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...verifyCode];
    newOtp[index] = value.slice(-1);
    setVerifyCode(newOtp);
    
    if (value && index < 5) {
      verifyCodeRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !verifyCode[index] && index > 0) {
      verifyCodeRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newOtp = [...verifyCode];
    for (let i = 0; i < pastedData.length; i++) {
      newOtp[i] = pastedData[i];
    }
    setVerifyCode(newOtp);
    const focusIndex = Math.min(pastedData.length, 5);
    verifyCodeRefs.current[focusIndex]?.focus();
  };

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '****';
    return `${maskedLocal}@${domain}`;
  };

  // Handle Add Passkey button click
  const handleAddPasskeyClick = () => {
    setShowAddModal(true);
  };

  // Handle Continue button in Add Passkey modal
  const handleContinue = () => {
    setShowAddModal(false);
    if (user2faEnabled) {
      setShowVerifyModal(true);
    } else {
      createPasskey();
    }
  };

  // Verify 2FA and create passkey
  const verify2faAndCreatePasskey = async () => {
    const code = verifyCode.join('');
    if (code.length !== 6) return;

    setVerifying(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/2fa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ code }),
      });
      const result = await response.json();

      if (result.success) {
        setShowVerifyModal(false);
        setVerifyCode(['', '', '', '', '', '']);
        await createPasskey();
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Invalid 2FA code', variant: 'destructive' });
      }
    } catch (error) {
      console.error('2FA verification failed:', error);
      toast({ title: 'Error', description: 'Verification failed', variant: 'destructive' });
    } finally {
      setVerifying(false);
    }
  };

  // Create passkey using WebAuthn
  const createPasskey = async () => {
    setCreating(true);
    try {
      // Get challenge from backend
      const challengeRes = await fetch(`${apiUrl}/api/v1/auth/passkeys/challenge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
      const challengeResult = await challengeRes.json();

      if (!challengeResult.success) {
        throw new Error(challengeResult.error?.message || 'Failed to get challenge');
      }

      const { challenge, userId, userName, userDisplayName, rpId, rpName } = challengeResult.data;

      // Convert base64 to ArrayBuffer (handle URL-safe base64)
      const base64ToArrayBuffer = (base64: string) => {
        // Convert URL-safe base64 to standard base64
        const standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
        const binaryString = atob(standardBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      };

      // Create credential using WebAuthn API
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: base64ToArrayBuffer(challenge),
          rp: {
            name: rpName,
            id: rpId,
          },
          user: {
            id: base64ToArrayBuffer(userId),
            name: userName,
            displayName: userDisplayName,
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },
            { alg: -257, type: 'public-key' },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'required',
          },
          timeout: 60000,
          attestation: 'none',
        },
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to create credential');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Convert ArrayBuffer to URL-safe base64
      const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      };

      // Send credential to backend
      const registerRes = await fetch(`${apiUrl}/api/v1/auth/passkeys/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          credentialId: arrayBufferToBase64(credential.rawId),
          clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
          attestationObject: arrayBufferToBase64(response.attestationObject),
          name: `iCloud Keychain #${passkeys.length + 1}`,
        }),
      });
      const registerResult = await registerRes.json();

      if (registerResult.success) {
        // Refresh passkeys list
        const passkeysRes = await fetch(`${apiUrl}/api/v1/auth/passkeys`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const passkeysResult = await passkeysRes.json();
        if (passkeysResult.success) {
          setPasskeys(passkeysResult.data.passkeys || []);
        }
        toast({ title: 'Passkey added successfully', variant: 'success' });
      } else {
        throw new Error(registerResult.error?.message || 'Failed to register passkey');
      }
    } catch (error: any) {
      console.error('Failed to create passkey:', error);
      if (error.name === 'NotAllowedError') {
        toast({ title: 'Cancelled', description: 'Passkey creation was cancelled or not allowed', variant: 'destructive' });
      } else if (error.name === 'NotSupportedError') {
        toast({ title: 'Not supported', description: 'Passkeys are not supported on this device', variant: 'destructive' });
      } else {
        toast({ title: 'Error', description: error.message || 'Failed to create passkey', variant: 'destructive' });
      }
    } finally {
      setCreating(false);
    }
  };

  // Handle Rename
  const handleRenameClick = (passkey: Passkey) => {
    setRenamePasskeyId(passkey.id);
    setRenameName(passkey.name);
    setShowRenameModal(true);
  };

  const submitRename = async () => {
    if (!renameName.trim()) return;
    setRenaming(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/passkeys/${renamePasskeyId}/rename`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      const result = await response.json();

      if (result.success) {
        setPasskeys(passkeys.map(p => p.id === renamePasskeyId ? { ...p, name: renameName.trim() } : p));
        setShowRenameModal(false);
        setRenamePasskeyId('');
        setRenameName('');
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to rename passkey', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to rename passkey:', error);
      toast({ title: 'Error', description: 'Failed to rename passkey', variant: 'destructive' });
    } finally {
      setRenaming(false);
    }
  };

  // Handle Delete
  const handleDeleteClick = (passkey: Passkey) => {
    setDeletePasskeyId(passkey.id);
    setShowDeleteConfirmModal(true);
  };

  const handleDeleteConfirm = () => {
    setShowDeleteConfirmModal(false);
    setShowDeleteVerifyModal(true);
    sendDeleteEmailOtp();
  };

  const sendDeleteEmailOtp = async () => {
    if (sendingDeleteEmailOtp || deleteEmailOtpTimer > 0) return;
    setSendingDeleteEmailOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', purpose: 'passkey_delete' }),
      });
      const result = await response.json();
      if (result.success) {
        setDeleteEmailOtpTimer(60);
      }
    } catch (error) {
      console.error('Failed to send email OTP:', error);
    } finally {
      setSendingDeleteEmailOtp(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteEmailOtp || (user2faEnabled && !delete2faCode)) return;
    setDeleting(true);
    try {
      // First verify email OTP
      const verifyEmailRes = await fetch(`${apiUrl}/api/v1/auth/verify-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ type: 'email', otp: deleteEmailOtp, purpose: 'passkey_delete' }),
      });
      const verifyEmailResult = await verifyEmailRes.json();

      if (!verifyEmailResult.success) {
        toast({ title: 'Error', description: verifyEmailResult.error?.message || 'Invalid email verification code', variant: 'destructive' });
        setDeleting(false);
        return;
      }

      // If 2FA enabled, verify 2FA
      if (user2faEnabled) {
        const verify2faRes = await fetch(`${apiUrl}/api/v1/auth/2fa/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ code: delete2faCode }),
        });
        const verify2faResult = await verify2faRes.json();

        if (!verify2faResult.success) {
          toast({ title: 'Error', description: verify2faResult.error?.message || 'Invalid 2FA code', variant: 'destructive' });
          setDeleting(false);
          return;
        }
      }

      // Delete passkey
      const response = await fetch(`${apiUrl}/api/v1/auth/passkeys/${deletePasskeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();

      if (result.success) {
        setPasskeys(passkeys.filter(p => p.id !== deletePasskeyId));
        closeAllModals();
        // If no passkeys left, show empty state
        if (passkeys.length <= 1) {
          // Already handled by the UI
        }
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to delete passkey', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to delete passkey:', error);
      toast({ title: 'Error', description: 'Failed to delete passkey', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  };

  const closeAllModals = () => {
    setShowAddModal(false);
    setShowVerifyModal(false);
    setShowRenameModal(false);
    setShowDeleteConfirmModal(false);
    setShowDeleteVerifyModal(false);
    setVerifyCode(['', '', '', '', '', '']);
    setRenamePasskeyId('');
    setRenameName('');
    setDeletePasskeyId('');
    setDeleteEmailOtp('');
    setDelete2faCode('');
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Link href="/dashboard/security" className="hover:text-blue-500">Security</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground">Passkeys</span>
      </div>

      {/* Main Card */}
      <div className="bg-card rounded-xl p-6">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-foreground mb-2">Passkeys</h1>
          <p className="text-sm text-muted-foreground">
            Please add a passkey for faster and more secure account protection.{' '}
            <Link href="/dashboard/help#passkeys" className="text-blue-500 hover:underline">Learn More →</Link>
          </p>
        </div>

        {/* Passkey Count Banner */}
        {passkeys.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4 flex items-center gap-2">
            <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </div>
            <span className="text-sm text-foreground/80">
              You have created {passkeys.length} passkey(s) (up to 10 can be set).
            </span>
          </div>
        )}

        {/* Table */}
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Passkey Name</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Creation Time:</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Last Used Time:</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-20 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                  </td>
                </tr>
              ) : passkeys.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      {/* Phone icon illustration */}
                      <div className="w-20 h-20 mb-4 flex items-center justify-center">
                        <svg viewBox="0 0 80 80" fill="none" className="w-full h-full">
                          <rect x="20" y="10" width="40" height="60" rx="4" stroke="#D1D5DB" strokeWidth="2" fill="none" />
                          <rect x="24" y="18" width="32" height="40" rx="2" fill="#F3F4F6" className="dark:fill-gray-700" />
                          <circle cx="40" cy="64" r="3" fill="#D1D5DB" />
                          <path d="M35 30 L45 30 M35 35 L45 35 M35 40 L42 40" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
                          {/* Key indicator */}
                          <circle cx="58" cy="22" r="8" fill="#FCD34D" />
                          <path d="M56 22 L60 22 M58 20 L58 24" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </div>
                      <p className="text-muted-foreground mb-4">No Passkeys Available</p>
                      <button
                        onClick={handleAddPasskeyClick}
                        disabled={creating}
                        className="px-6 py-2.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                      >
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : '+'}
                        Add Passkey
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                passkeys.map((passkey) => (
                  <tr key={passkey.id} className="border-t border-border">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <KeyRound className="w-5 h-5 text-gray-400" />
                        <span className="text-sm text-foreground">{passkey.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{formatDate(passkey.created_at)}</td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{formatDate(passkey.last_used_at)}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <button
                          onClick={() => handleRenameClick(passkey)}
                          className="text-primary hover:text-primary/85 text-sm font-medium"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleDeleteClick(passkey)}
                          className="text-red-500 hover:text-red-600 text-sm font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Add button when passkeys exist */}
        {passkeys.length > 0 && passkeys.length < 10 && (
          <div className="mt-4">
            <button
              onClick={handleAddPasskeyClick}
              disabled={creating}
              className="px-6 py-2.5 bg-primary hover:bg-primary/85 disabled:bg-gray-300 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : '+'}
              Add Passkey
            </button>
          </div>
        )}
      </div>

      {/* Add Passkey Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex justify-end mb-2">
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Illustration */}
              <div className="flex justify-center mb-4">
                <div className="w-24 h-24 relative">
                  <svg viewBox="0 0 100 100" fill="none" className="w-full h-full">
                    <circle cx="50" cy="30" r="12" fill="#FCD34D" />
                    <path d="M35 50 C35 42 45 38 50 38 C55 38 65 42 65 50 L65 70 L35 70 Z" fill="#FCD34D" />
                    <rect x="30" y="55" width="40" height="25" rx="2" fill="#F59E0B" />
                    <rect x="33" y="58" width="34" height="16" fill="#FEF3C7" />
                    <circle cx="75" cy="25" r="6" fill="#10B981" />
                    <circle cx="80" cy="40" r="4" fill="#3B82F6" />
                    <circle cx="20" cy="35" r="5" fill="#8B5CF6" />
                  </svg>
                </div>
              </div>

              <h2 className="text-xl font-semibold text-foreground text-center mb-6">
                Add Passkey
              </h2>

              <div className="space-y-4 mb-6">
                <div className="flex items-start gap-3">
                  <Lock className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-medium text-foreground text-sm">No Need to Remember Passwords</h3>
                    <p className="text-sm text-muted-foreground">
                      With a passkey, you can log in using fingerprint or face recognition.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Monitor className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-medium text-foreground text-sm">Works on All Your Devices</h3>
                    <p className="text-sm text-muted-foreground">
                      Passkeys will automatically be available on all your synced devices.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-medium text-foreground text-sm">Ensure Your Account's Security</h3>
                    <p className="text-sm text-muted-foreground">
                      Passkeys provide state-of-the-art phishing protection.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleContinue}
                className="w-full py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-lg transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA Verification Modal (for Add) */}
      {showVerifyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Security Verification</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-6">
                <label className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                  <Shield className="w-4 h-4" />
                  Google 2FA Code
                </label>
                <div className="flex justify-center gap-2">
                  {verifyCode.map((digit, index) => (
                    <input
                      key={index}
                      ref={el => { verifyCodeRefs.current[index] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpInput(index, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(index, e)}
                      onPaste={handleOtpPaste}
                      className="w-12 h-14 text-center text-xl font-semibold border border-border rounded-lg bg-accent text-foreground focus:border-blue-500 focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  ))}
                </div>
              </div>

              <p className="text-center text-sm text-blue-500 hover:underline cursor-pointer mb-6">
                Having problems with verification?
              </p>

              <button
                onClick={verify2faAndCreatePasskey}
                disabled={verifying || verifyCode.join('').length !== 6}
                className="w-full py-3 bg-primary hover:bg-primary/85 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {verifying ? (
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

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Rename Passkey</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-6">
                <input
                  type="text"
                  value={renameName}
                  onChange={e => setRenameName(e.target.value.slice(0, 50))}
                  placeholder="Enter passkey name"
                  className="w-full px-4 py-3 bg-accent border border-border rounded-lg text-foreground focus:border-blue-500 focus:ring-2 focus:ring-primary/20 outline-none"
                />
                <div className="text-right mt-1 text-sm text-gray-400">
                  {renameName.length}/50
                </div>
              </div>

              <button
                onClick={submitRename}
                disabled={renaming || !renameName.trim()}
                className="w-full py-3 bg-primary hover:bg-primary/85 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {renaming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
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

              <h2 className="text-lg font-semibold text-foreground text-center mb-4">
                Are you sure you want to delete the passkey?
              </h2>

              <div className="bg-accent/50 rounded-lg p-4 mb-6">
                <p className="text-sm font-medium text-foreground/80 mb-2">Please note:</p>
                <p className="text-sm text-muted-foreground">
                  For account security, please be aware that after deleting your passkey, on-chain withdrawals, internal transfers, fiat withdrawals, Card transactions, P2P Trading, and advertising will be suspended for 24 hours.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-lg transition-colors"
                >
                  Delete Passkey
                </button>
                <button
                  onClick={closeAllModals}
                  className="flex-1 py-3 bg-accent hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-white font-medium rounded-lg transition-colors border border-border"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Verification Modal */}
      {showDeleteVerifyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Security Verification</h2>
                <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Email OTP */}
              <div className="mb-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Mail className="w-4 h-4" />
                  <span>A verification code will be sent to <strong className="text-foreground">{maskEmail(user?.email || '')}</strong></span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={deleteEmailOtp}
                    onChange={e => setDeleteEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Please enter the email verification code"
                    className="w-full px-4 py-3 bg-accent border border-border rounded-lg text-foreground focus:border-blue-500 focus:ring-2 focus:ring-primary/20 outline-none pr-24"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {deleteEmailOtpTimer > 0 ? (
                      <span className="text-sm text-blue-500 font-medium">{deleteEmailOtpTimer}s</span>
                    ) : (
                      <button
                        onClick={sendDeleteEmailOtp}
                        disabled={sendingDeleteEmailOtp}
                        className="text-sm text-primary hover:text-primary/85 font-medium"
                      >
                        {sendingDeleteEmailOtp ? 'Sending...' : 'Send Verification Code'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Google 2FA Code */}
              {user2faEnabled && (
                <div className="mb-6">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <Shield className="w-4 h-4" />
                    Google 2FA Code
                  </label>
                  <input
                    type="text"
                    value={delete2faCode}
                    onChange={e => setDelete2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Please enter the Google Authenticator code"
                    className="w-full px-4 py-3 bg-accent border border-border rounded-lg text-foreground focus:border-blue-500 focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
              )}

              <button
                onClick={submitDelete}
                disabled={deleting || !deleteEmailOtp || (user2faEnabled && delete2faCode.length !== 6)}
                className="w-full py-3 bg-primary hover:bg-primary/85 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Next Step'
                )}
              </button>

              <p className="text-center text-sm text-blue-500 hover:underline cursor-pointer mt-4">
                Having problems with verification?
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
