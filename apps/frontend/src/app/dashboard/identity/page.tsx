'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import Image from 'next/image';
import {
  Globe,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Building2,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';

interface Country {
  code: string;
  name: string;
  flag: string;
}

interface DocumentType {
  id: string;
  name: string;
  icon: string;
  recommended?: boolean;
  description?: string;
}

const countries: Country[] = [
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'UK', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
];

const documentTypes: Record<string, DocumentType[]> = {
  'IN': [
    { id: 'aadhaar', name: 'Aadhaar', icon: '🪪', recommended: true },
    { id: 'pan', name: 'PAN Card', icon: '💳' },
    { id: 'passport', name: 'Passport', icon: '📕' },
    { id: 'driving_license', name: 'Driving License', icon: '🚗' },
    { id: 'voter_id', name: 'Voter ID', icon: '🗳️' },
  ],
  'default': [
    { id: 'passport', name: 'Passport', icon: '📕', recommended: true },
    { id: 'national_id', name: 'National ID Card', icon: '🪪' },
    { id: 'driving_license', name: 'Driving License', icon: '🚗' },
  ],
};

export default function IdentityVerificationPage() {
  const router = useRouter();
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<string>('');
  const [showOtherDocuments, setShowOtherDocuments] = useState(false);
  const [showDigiLocker, setShowDigiLocker] = useState(false);
  const [digiLockerConsent, setDigiLockerConsent] = useState({
    aadhaar: true,
    drivingLicense: false,
    pan: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [kycLevel, setKycLevel] = useState<number>(0);
  const [checkingKyc, setCheckingKyc] = useState(true);

  const API_URL = getApiBaseUrl();

  // Check KYC status on mount
  useEffect(() => {
    const checkKycStatus = async () => {
      if (!_hasHydrated || !accessToken) return;
      
      try {
        const response = await fetch(`${API_URL}/api/v1/auth/profile`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await response.json();
        
        if (result.success && result.data?.user) {
          setKycStatus(result.data.user.kycStatus || 'not_submitted');
          setKycLevel(result.data.user.kycLevel || 0);
        }
      } catch (err) {
        console.error('Failed to check KYC status:', err);
      } finally {
        setCheckingKyc(false);
      }
    };
    
    checkKycStatus();
  }, [accessToken, _hasHydrated]);

  const availableDocuments = documentTypes[selectedCountry.code] || documentTypes['default'];
  const quickVerification = availableDocuments.find(d => d.recommended);
  const otherDocuments = availableDocuments.filter(d => !d.recommended);

  const handleVerifyClick = () => {
    if (selectedCountry.code === 'IN' && (selectedDocument === 'aadhaar' || !selectedDocument)) {
      setShowDigiLocker(true);
    } else {
      // Proceed to document upload
      router.push(`/dashboard/identity/upload?doc=${selectedDocument || quickVerification?.id}`);
    }
  };

  const handleDigiLockerContinue = async () => {
    setLoading(true);
    setError('');

    try {
      // Simulate DigiLocker verification
      const response = await fetch(`${API_URL}/api/v1/kyc/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          country: selectedCountry.code,
          documentType: selectedDocument || 'aadhaar',
          provider: 'digilocker',
          consent: digiLockerConsent,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // For demo, mark KYC as approved
        router.push('/dashboard/identity/success');
      } else {
        setError(data.error?.message || 'Verification failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  // Show loading while checking KYC
  if (checkingKyc) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Checking verification status...</p>
        </div>
      </div>
    );
  }

  // Show verified state if KYC is approved
  if (kycStatus === 'approved') {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-2xl font-bold text-gray-900 dark:text-white">
              <span className="bg-blue-500 text-white px-2 py-1 rounded mr-1">M</span>
              Methereum
            </Link>
            <span className="text-gray-400">|</span>
            <h1 className="text-lg font-medium text-gray-900 dark:text-white">Identity Verification</h1>
          </div>
        </header>

        {/* Verified Content */}
        <main className="max-w-2xl mx-auto px-6 py-12">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 shadow-sm border border-gray-200 dark:border-gray-800 text-center">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-green-500" />
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Identity Verified
            </h2>
            
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Your identity has been successfully verified. You now have full access to all platform features.
            </p>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-600 dark:text-gray-400">Verification Level</span>
                <span className="font-semibold text-gray-900 dark:text-white">Level {kycLevel}</span>
              </div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-600 dark:text-gray-400">Status</span>
                <span className="flex items-center gap-2 text-green-500 font-semibold">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  Verified
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 dark:text-gray-400">Daily Withdrawal Limit</span>
                <span className="font-semibold text-gray-900 dark:text-white">Unlimited</span>
              </div>
            </div>

            <Link
              href="/dashboard/account"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors"
            >
              Go to Account
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>© 2018-2026 Methereum.com. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  // Show pending state if KYC is pending
  if (kycStatus === 'pending') {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950">
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-2xl font-bold text-gray-900 dark:text-white">
              <span className="bg-blue-500 text-white px-2 py-1 rounded mr-1">M</span>
              Methereum
            </Link>
            <span className="text-gray-400">|</span>
            <h1 className="text-lg font-medium text-gray-900 dark:text-white">Identity Verification</h1>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-12">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 shadow-sm border border-gray-200 dark:border-gray-800 text-center">
            <div className="w-20 h-20 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-10 h-10 text-yellow-500" />
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Verification In Progress
            </h2>
            
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Your documents are being reviewed. This usually takes 1-2 business days.
            </p>

            <Link
              href="/dashboard/account"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl transition-colors"
            >
              Go to Account
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-2xl font-bold text-gray-900 dark:text-white">
            <span className="bg-blue-500 text-white px-2 py-1 rounded mr-1">M</span>
            Methereum
          </Link>
          <span className="text-gray-400">|</span>
          <h1 className="text-lg font-medium text-gray-900 dark:text-white">Identity Verification</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/help#business"
            className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <Building2 className="w-4 h-4" />
            Business Verification
          </Link>
          <button className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            <Globe className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-6 py-12">
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 shadow-sm border border-gray-200 dark:border-gray-800">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">
            Proof of Identity
          </h2>

          {/* Country Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Country/region of issue
            </label>
            <div className="relative">
              <button
                onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-left hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{selectedCountry.flag}</span>
                  <span className="text-gray-900 dark:text-white font-medium">{selectedCountry.name}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-500">
                  <Globe className="w-4 h-4" />
                  <span className="text-sm">Location</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {showCountryDropdown && (
                <div className="absolute z-10 top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  {countries.map((country) => (
                    <button
                      key={country.code}
                      onClick={() => {
                        setSelectedCountry(country);
                        setShowCountryDropdown(false);
                        setSelectedDocument('');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <span className="text-xl">{country.flag}</span>
                      <span className="text-gray-900 dark:text-white">{country.name}</span>
                      {selectedCountry.code === country.code && (
                        <Check className="w-4 h-4 text-green-500 ml-auto" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Warning for India */}
          {selectedCountry.code === 'IN' && (
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl text-sm text-gray-600 dark:text-gray-400">
              If you have chosen the ID Card, please note that you cannot submit PAN Document otherwise it will be rejected. 
              It is recommended to use Aadhaar Card or Voter ID.
            </div>
          )}

          {/* Quick Verification */}
          {quickVerification && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Quick verification
              </h3>
              <button
                onClick={() => setSelectedDocument(quickVerification.id)}
                className={`w-full flex items-center gap-4 px-4 py-4 border-2 rounded-xl transition-colors ${
                  selectedDocument === quickVerification.id || !selectedDocument
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                  <span className="text-2xl">{quickVerification.icon}</span>
                </div>
                <span className="text-gray-900 dark:text-white font-medium flex-1 text-left">
                  {quickVerification.name}
                </span>
                <span className="px-3 py-1 bg-blue-500 text-gray-900 text-xs font-semibold rounded-full">
                  Recommended
                </span>
              </button>
            </div>
          )}

          {/* Other Documents */}
          <div className="mb-8">
            <button
              onClick={() => setShowOtherDocuments(!showOtherDocuments)}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              No {quickVerification?.name}? Use other documents.
              <ChevronDown className={`w-4 h-4 transition-transform ${showOtherDocuments ? 'rotate-180' : ''}`} />
            </button>

            {showOtherDocuments && (
              <div className="mt-4 space-y-3">
                {otherDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocument(doc.id)}
                    className={`w-full flex items-center gap-4 px-4 py-3 border-2 rounded-xl transition-colors ${
                      selectedDocument === doc.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <span className="text-xl">{doc.icon}</span>
                    <span className="text-gray-900 dark:text-white">{doc.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* CTA Button */}
          <button
            onClick={handleVerifyClick}
            disabled={loading}
            className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <span className="text-xl">🎁</span>
            Verify to Earn $20
          </button>

          {/* App Link */}
          <div className="mt-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              You can also continue on{' '}
              <Link href="/dashboard/help" className="text-gray-900 dark:text-white font-medium hover:underline inline-flex items-center gap-1">
                📱 Methereum App
                <ChevronRight className="w-4 h-4" />
              </Link>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>© 2018-2026 Methereum.com. All rights reserved.</p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white">Privacy Policy</Link>
        </div>
      </footer>

      {/* DigiLocker Modal */}
      {showDigiLocker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-end p-4">
              <button
                onClick={() => setShowDigiLocker(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="px-8 pb-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
                Share Aadhaar & PAN for faster verification
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-center text-sm mb-6">
                Select PAN verification to skip extra steps later.
              </p>

              {/* DigiLocker Card */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-10 bg-blue-600 rounded flex items-center justify-center">
                      <span className="text-white font-bold text-sm">DigiLocker</span>
                    </div>
                  </div>
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                </div>

                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  Please provide your consent to share the following with <strong>Methereum</strong>:
                </p>

                {/* Documents List */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                      <span className="text-gray-700 dark:text-gray-300 font-medium">Issued Documents (3)</span>
                    </div>
                    <button className="text-blue-500 text-sm font-medium">Select all</button>
                  </div>
                  
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    <label className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <span className="text-gray-900 dark:text-white">Aadhaar Card</span>
                      <input
                        type="checkbox"
                        checked={digiLockerConsent.aadhaar}
                        onChange={(e) => setDigiLockerConsent({ ...digiLockerConsent, aadhaar: e.target.checked })}
                        className="w-5 h-5 text-green-500 rounded border-gray-300 focus:ring-green-500"
                      />
                    </label>
                    <label className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <div>
                        <span className="text-gray-900 dark:text-white">Driving License</span>
                        <span className="text-gray-400 text-sm ml-2">(can be accessed)</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={digiLockerConsent.drivingLicense}
                        onChange={(e) => setDigiLockerConsent({ ...digiLockerConsent, drivingLicense: e.target.checked })}
                        className="w-5 h-5 text-green-500 rounded border-gray-300 focus:ring-green-500"
                      />
                    </label>
                    <label className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <span className="text-gray-900 dark:text-white">PAN Verification Record</span>
                      <input
                        type="checkbox"
                        checked={digiLockerConsent.pan}
                        onChange={(e) => setDigiLockerConsent({ ...digiLockerConsent, pan: e.target.checked })}
                        className="w-5 h-5 text-green-500 rounded border-gray-300 focus:ring-green-500"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Continue Button */}
              <button
                onClick={handleDigiLockerContinue}
                disabled={loading || (!digiLockerConsent.aadhaar && !digiLockerConsent.pan)}
                className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Verifying...' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Button */}
      <button className="fixed bottom-6 right-6 w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-40">
        <HelpCircle className="w-6 h-6" />
      </button>
    </div>
  );
}
