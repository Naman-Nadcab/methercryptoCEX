'use client';

import { useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import Image from 'next/image';
import {
  Upload,
  Camera,
  X,
  ChevronLeft,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';

const documentLabels: Record<string, string> = {
  aadhaar: 'Aadhaar Card',
  pan: 'PAN Card',
  passport: 'Passport',
  driving_license: 'Driving License',
  voter_id: 'Voter ID',
  national_id: 'National ID Card',
};

function DocumentUploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken } = useAuthStore();
  
  const documentType = searchParams.get('doc') || 'passport';
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [backImage, setBackImage] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'front' | 'back' | 'selfie' | 'review'>('front');

  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  const API_URL = getApiBaseUrl();

  const needsBackImage = ['aadhaar', 'national_id', 'driving_license', 'voter_id'].includes(documentType);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'front' | 'back' | 'selfie') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setError('');
    const preview = URL.createObjectURL(file);

    switch (type) {
      case 'front':
        setFrontImage(file);
        setFrontPreview(preview);
        if (needsBackImage) {
          setStep('back');
        } else {
          setStep('selfie');
        }
        break;
      case 'back':
        setBackImage(file);
        setBackPreview(preview);
        setStep('selfie');
        break;
      case 'selfie':
        setSelfie(file);
        setSelfiePreview(preview);
        setStep('review');
        break;
    }
  };

  const handleSubmit = async () => {
    if (!frontImage || !selfie) {
      setError('Please upload all required documents');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('documentType', documentType);
      formData.append('frontImage', frontImage);
      if (backImage) {
        formData.append('backImage', backImage);
      }
      formData.append('selfie', selfie);

      const response = await fetch(`${API_URL}/api/v1/kyc/upload-document`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        router.push('/dashboard/identity/success');
      } else {
        setError(data.error?.message || data.error?.code || 'Upload failed. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-accent rounded-full transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              Upload {documentLabels[documentType] || 'Document'}
            </h1>
            <p className="text-sm text-gray-500">Step {['front', 'back', 'selfie', 'review'].indexOf(step) + 1} of {needsBackImage ? 4 : 3}</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-6 py-8">
        <div className="bg-card rounded-xl p-6 shadow-sm border border-border">
          
          {/* Progress Bar */}
          <div className="flex gap-2 mb-8">
            {['front', ...(needsBackImage ? ['back'] : []), 'selfie', 'review'].map((s, i) => (
              <div
                key={s}
                className={`flex-1 h-1 rounded-full ${
                  ['front', ...(needsBackImage ? ['back'] : []), 'selfie', 'review'].indexOf(step) >= i
                    ? 'bg-blue-500'
                    : 'bg-accent'
                }`}
              />
            ))}
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* Front Image Upload */}
          {step === 'front' && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Upload Front Side
                </h2>
                <p className="text-muted-foreground">
                  Take a clear photo of the front of your {documentLabels[documentType]}
                </p>
              </div>

              <div
                onClick={() => frontInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center cursor-pointer hover:border-blue-500 transition-colors"
              >
                {frontPreview ? (
                  <div className="relative">
                    <img src={frontPreview} alt="Front" className="max-h-64 mx-auto rounded-lg" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFrontImage(null);
                        setFrontPreview(null);
                      }}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-muted-foreground">Click to upload or drag and drop</p>
                    <p className="text-sm text-gray-400 mt-1">PNG, JPG up to 10MB</p>
                  </>
                )}
              </div>
              <input
                ref={frontInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFileSelect(e, 'front')}
                className="hidden"
              />

              <button
                onClick={() => frontInputRef.current?.click()}
                className="w-full py-3 bg-accent hover:bg-accent text-foreground font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Take Photo
              </button>
            </div>
          )}

          {/* Back Image Upload */}
          {step === 'back' && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Upload Back Side
                </h2>
                <p className="text-muted-foreground">
                  Take a clear photo of the back of your {documentLabels[documentType]}
                </p>
              </div>

              <div
                onClick={() => backInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center cursor-pointer hover:border-blue-500 transition-colors"
              >
                {backPreview ? (
                  <div className="relative">
                    <img src={backPreview} alt="Back" className="max-h-64 mx-auto rounded-lg" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setBackImage(null);
                        setBackPreview(null);
                      }}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-muted-foreground">Click to upload or drag and drop</p>
                    <p className="text-sm text-gray-400 mt-1">PNG, JPG up to 10MB</p>
                  </>
                )}
              </div>
              <input
                ref={backInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFileSelect(e, 'back')}
                className="hidden"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('front')}
                  className="flex-1 py-3 bg-accent hover:bg-accent text-foreground font-medium rounded-xl transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => backInputRef.current?.click()}
                  className="flex-1 py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Camera className="w-5 h-5" />
                  Take Photo
                </button>
              </div>
            </div>
          )}

          {/* Selfie Upload */}
          {step === 'selfie' && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Take a Selfie
                </h2>
                <p className="text-muted-foreground">
                  Take a clear selfie holding your {documentLabels[documentType]}
                </p>
              </div>

              <div
                onClick={() => selfieInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 text-center cursor-pointer hover:border-blue-500 transition-colors"
              >
                {selfiePreview ? (
                  <div className="relative">
                    <img src={selfiePreview} alt="Selfie" className="max-h-64 mx-auto rounded-lg" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelfie(null);
                        setSelfiePreview(null);
                      }}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="w-24 h-24 rounded-full bg-accent mx-auto mb-4 flex items-center justify-center">
                      <Camera className="w-10 h-10 text-gray-400" />
                    </div>
                    <p className="text-muted-foreground">Click to take or upload a selfie</p>
                  </>
                )}
              </div>
              <input
                ref={selfieInputRef}
                type="file"
                accept="image/*"
                capture="user"
                onChange={(e) => handleFileSelect(e, 'selfie')}
                className="hidden"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(needsBackImage ? 'back' : 'front')}
                  className="flex-1 py-3 bg-accent hover:bg-accent text-foreground font-medium rounded-xl transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => selfieInputRef.current?.click()}
                  className="flex-1 py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Camera className="w-5 h-5" />
                  Take Selfie
                </button>
              </div>
            </div>
          )}

          {/* Review */}
          {step === 'review' && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Review Your Documents
                </h2>
                <p className="text-muted-foreground">
                  Make sure all images are clear and readable
                </p>
              </div>

              <div className="grid gap-4">
                <div className="flex items-center gap-4 p-4 bg-muted rounded-xl">
                  {frontPreview && (
                    <img src={frontPreview} alt="Front" className="w-20 h-14 object-cover rounded-lg" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-foreground">Front Side</p>
                    <p className="text-sm text-green-500 flex items-center gap-1">
                      <Check className="w-4 h-4" /> Uploaded
                    </p>
                  </div>
                  <button
                    onClick={() => setStep('front')}
                    className="text-blue-500 text-sm hover:underline"
                  >
                    Change
                  </button>
                </div>

                {needsBackImage && backPreview && (
                  <div className="flex items-center gap-4 p-4 bg-muted rounded-xl">
                    <img src={backPreview} alt="Back" className="w-20 h-14 object-cover rounded-lg" />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">Back Side</p>
                      <p className="text-sm text-green-500 flex items-center gap-1">
                        <Check className="w-4 h-4" /> Uploaded
                      </p>
                    </div>
                    <button
                      onClick={() => setStep('back')}
                      className="text-blue-500 text-sm hover:underline"
                    >
                      Change
                    </button>
                  </div>
                )}

                {selfiePreview && (
                  <div className="flex items-center gap-4 p-4 bg-muted rounded-xl">
                    <img src={selfiePreview} alt="Selfie" className="w-20 h-20 object-cover rounded-full" />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">Selfie</p>
                      <p className="text-sm text-green-500 flex items-center gap-1">
                        <Check className="w-4 h-4" /> Uploaded
                      </p>
                    </div>
                    <button
                      onClick={() => setStep('selfie')}
                      className="text-blue-500 text-sm hover:underline"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('selfie')}
                  className="flex-1 py-3 bg-accent hover:bg-accent text-foreground font-medium rounded-xl transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 py-3 bg-primary hover:bg-primary/85 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    'Submit for Verification'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tips */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <h3 className="font-medium text-blue-800 dark:text-blue-400 mb-2">Tips for a successful verification</h3>
          <ul className="text-sm text-blue-700 dark:text-blue-500 space-y-1">
            <li>• Make sure the document is fully visible and not cut off</li>
            <li>• Avoid glare and ensure good lighting</li>
            <li>• All text should be clearly readable</li>
            <li>• For selfie, hold the document next to your face</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

export default function DocumentUploadPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    }>
      <DocumentUploadContent />
    </Suspense>
  );
}
