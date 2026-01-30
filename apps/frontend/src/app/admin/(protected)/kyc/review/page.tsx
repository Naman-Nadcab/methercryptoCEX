'use client';

export default function KYCReviewPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Under Review</h1>
      <p className="text-gray-400 text-sm">KYC applications being reviewed</p>
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <p className="text-gray-500 text-center">No KYC under review</p>
      </div>
    </div>
  );
}
