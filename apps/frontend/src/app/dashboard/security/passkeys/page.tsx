'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  ChevronRight,
  Lock,
  Monitor,
  ShieldCheck,
  X,
  Loader2,
  AlertTriangle,
  Shield,
  Mail,
  KeyRound,
  Edit3,
  Fingerprint,
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';

interface Passkey {
  id: string;
  device_name: string;
  created_at: string;
  last_used_at: string | null;
}

export default function PasskeysPage() {
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
      const challengeRes = await fetch(`${apiUrl}/api/v1/auth/passkey/register/options`, {
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
      const registerRes = await fetch(`${apiUrl}/api/v1/auth/passkey/register/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          credential: {
            id: arrayBufferToBase64(credential.rawId),
            rawId: arrayBufferToBase64(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
              attestationObject: arrayBufferToBase64(response.attestationObject),
            },
          },
          deviceName: `iCloud Keychain #${passkeys.length + 1}`,
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
    setRenameName(passkey.device_name);
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
        setPasskeys(passkeys.map(p => p.id === renamePasskeyId ? { ...p, device_name: renameName.trim() } : p));
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
        <Link href="/dashboard/security" className="hover:text-primary">Security</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground">Passkeys</span>
      </div>

      {/* Main Card */}
      <div className="rounded-xl border border-border bg-card p-6">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-foreground mb-2">Passkeys</h1>
          <p className="text-sm text-muted-foreground">
            Please add a passkey for faster and more secure account protection.{' '}
            <Link href="/dashboard/help#passkeys" className="text-primary hover:underline">Learn More →</Link>
          </p>
        </div>

        {/* Passkey Count Banner */}
        {passkeys.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
              <span className="text-xs font-bold text-primary-foreground">!</span>
            </div>
            <span className="text-sm text-foreground">
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
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : passkeys.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      {/* Phone icon illustration */}
                      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        <KeyRound className="h-10 w-10" />
                      </div>
                      <p className="text-muted-foreground mb-4">No Passkeys Available</p>
                      <button
                        onClick={handleAddPasskeyClick}
                        disabled={creating}
                        className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground"
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
                        <KeyRound className="w-5 h-5 text-muted-foreground" />
                        <span className="text-sm text-foreground">{passkey.device_name}</span>
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
                          className="text-sm font-medium text-sell hover:text-sell/90"
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
              className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : '+'}
              Add Passkey
            </button>
          </div>
        )}
      </div>

      {/* Add Passkey Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-card shadow-xl">
            <div className="p-6">
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={closeAllModals} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-4 flex justify-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-muted text-primary">
                  <Fingerprint className="h-12 w-12" />
                </div>
              </div>

              <h2 className="text-xl font-semibold text-foreground text-center mb-6">
                Add Passkey
              </h2>

              <div className="space-y-4 mb-6">
                <div className="flex items-start gap-3">
                  <Lock className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-medium text-foreground text-sm">No Need to Remember Passwords</h3>
                    <p className="text-sm text-muted-foreground">
                      With a passkey, you can log in using fingerprint or face recognition.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Monitor className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-medium text-foreground text-sm">Works on All Your Devices</h3>
                    <p className="text-sm text-muted-foreground">
                      Passkeys will automatically be available on all your synced devices.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-medium text-foreground text-sm">Ensure Your Account's Security</h3>
                    <p className="text-sm text-muted-foreground">
                      Passkeys provide state-of-the-art phishing protection.
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleContinue}
                className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/85"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA Verification Modal (for Add) */}
      {showVerifyModal && (
        <div className="fixed inset-0 bg-foreground/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Security Verification</h2>
                <button onClick={closeAllModals} className="text-muted-foreground hover:text-muted-foreground">
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
                      className="h-14 w-12 rounded-lg border border-border bg-muted text-center text-xl font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                    />
                  ))}
                </div>
              </div>

              <p className="text-center text-sm text-primary hover:underline cursor-pointer mb-6">
                Having problems with verification?
              </p>

              <button
                onClick={verify2faAndCreatePasskey}
                disabled={verifying || verifyCode.join('').length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
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
        <div className="fixed inset-0 bg-foreground/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Rename Passkey</h2>
                <button onClick={closeAllModals} className="text-muted-foreground hover:text-muted-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-6">
                <input
                  type="text"
                  value={renameName}
                  onChange={e => setRenameName(e.target.value.slice(0, 50))}
                  placeholder="Enter passkey name"
                  className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
                <div className="mt-1 text-right text-sm text-muted-foreground">
                  {renameName.length}/50
                </div>
              </div>

              <button
                onClick={submitRename}
                disabled={renaming || !renameName.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
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
        <div className="fixed inset-0 bg-foreground/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex justify-end mb-4">
                <button onClick={closeAllModals} className="text-muted-foreground hover:text-muted-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Warning Icon */}
              <div className="flex justify-center mb-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <AlertTriangle className="h-8 w-8 text-primary" />
                </div>
              </div>

              <h2 className="text-lg font-semibold text-foreground text-center mb-4">
                Are you sure you want to delete the passkey?
              </h2>

              <div className="mb-6 rounded-lg border border-border bg-muted p-4">
                <p className="text-sm font-medium text-foreground/80 mb-2">Please note:</p>
                <p className="text-sm text-muted-foreground">
                  For account security, please be aware that after deleting your passkey, on-chain withdrawals, internal transfers, fiat withdrawals, Card transactions, P2P Trading, and advertising will be suspended for 24 hours.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  className="flex-1 rounded-lg bg-sell py-3 font-medium text-primary-foreground transition-colors hover:bg-sell/90"
                >
                  Delete Passkey
                </button>
                <button
                  type="button"
                  onClick={closeAllModals}
                  className="flex-1 rounded-lg border border-border bg-muted py-3 font-medium text-foreground transition-colors hover:bg-muted/80"
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
        <div className="fixed inset-0 bg-foreground/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">Security Verification</h2>
                <button onClick={closeAllModals} className="text-muted-foreground hover:text-muted-foreground">
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
                    className="w-full rounded-lg border border-border bg-muted px-4 py-3 pr-24 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {deleteEmailOtpTimer > 0 ? (
                      <span className="text-sm text-primary font-medium">{deleteEmailOtpTimer}s</span>
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
                    className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                </div>
              )}

              <button
                onClick={submitDelete}
                disabled={deleting || !deleteEmailOtp || (user2faEnabled && delete2faCode.length !== 6)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
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

              <p className="text-center text-sm text-primary hover:underline cursor-pointer mt-4">
                Having problems with verification?
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
