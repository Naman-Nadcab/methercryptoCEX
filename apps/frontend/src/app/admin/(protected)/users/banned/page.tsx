'use client';

import { Ban } from 'lucide-react';

export default function BannedUsersPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <Ban className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Banned Users</h2>
      <p className="text-muted-foreground max-w-md">
        Permanently banned accounts will appear here. Manage bans, review appeal requests, and audit enforcement actions.
      </p>
    </div>
  );
}
