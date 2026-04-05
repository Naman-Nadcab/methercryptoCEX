'use client';

import { UserX } from 'lucide-react';

export default function SuspendedUsersPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <UserX className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Suspended Users</h2>
      <p className="text-muted-foreground max-w-md">
        Temporarily suspended accounts will appear here. Review suspension reasons, manage durations, and process reinstatement requests.
      </p>
    </div>
  );
}
