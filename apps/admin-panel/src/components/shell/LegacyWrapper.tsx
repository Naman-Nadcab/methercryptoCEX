'use client';

/**
 * LegacyWrapper — isolation layer for old admin pages.
 * Preserves original spacing, padding, and light-theme styling
 * so legacy pages render exactly as before inside the new shell.
 */
export function LegacyWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="legacy-page-wrapper min-h-[calc(100vh-4rem)] bg-admin-bg p-6">
      {children}
    </div>
  );
}
