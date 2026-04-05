'use client';

import { ScanSearch } from 'lucide-react';

export default function KYCReviewPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <ScanSearch className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Under Review</h2>
      <p className="text-muted-foreground max-w-md">
        KYC applications currently being reviewed will appear here. Verify identity documents, cross-check data, and approve or escalate cases.
      </p>
    </div>
  );
}
