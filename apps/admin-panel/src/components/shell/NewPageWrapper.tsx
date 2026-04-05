'use client';

/**
 * NewPageWrapper — wrapper for pages that were previously v2.
 * Now uses the same light background as all other pages.
 */
export function NewPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="new-page-wrapper min-h-screen bg-[#F8FAFC]">
      {children}
    </div>
  );
}
