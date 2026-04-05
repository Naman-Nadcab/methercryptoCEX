'use client';

import { FileSpreadsheet } from 'lucide-react';

export default function CustomReportsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <FileSpreadsheet className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Custom Reports</h2>
      <p className="text-muted-foreground max-w-md">
        Build custom reports with flexible date ranges, metric selection, and export to CSV/PDF. Schedule recurring report delivery via email.
      </p>
    </div>
  );
}
