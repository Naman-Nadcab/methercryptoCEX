'use client';

import { ShieldAlert } from 'lucide-react';

export default function FraudDetectionPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <ShieldAlert className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Fraud Detection</h2>
      <p className="text-muted-foreground max-w-md">
        Real-time fraud monitoring with ML-powered anomaly detection, suspicious transaction flagging, and automated risk scoring.
      </p>
    </div>
  );
}
