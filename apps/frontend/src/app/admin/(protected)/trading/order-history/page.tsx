'use client';

import { History } from 'lucide-react';

export default function OrderHistoryPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <History className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Order History</h2>
      <p className="text-muted-foreground max-w-md">
        Full historical order data with advanced filtering, export options, and audit trail for all executed, cancelled, and expired orders.
      </p>
    </div>
  );
}
