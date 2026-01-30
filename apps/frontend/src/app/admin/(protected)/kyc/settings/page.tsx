'use client';

export default function KYCSettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">KYC Settings</h1>
      <p className="text-gray-400 text-sm">Configure KYC requirements</p>
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Document Requirements</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
            <span className="text-gray-700 dark:text-gray-300">Level 1: ID Document</span>
            <span className="text-green-400">Required</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
            <span className="text-gray-700 dark:text-gray-300">Level 2: ID + Selfie + Address</span>
            <span className="text-green-400">Required</span>
          </div>
        </div>
      </div>
    </div>
  );
}
