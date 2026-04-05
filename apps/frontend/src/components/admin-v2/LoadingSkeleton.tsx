'use client';

const shimmer = 'relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.04] before:to-transparent';

export function PanelSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-[#1F2937] bg-[#151922] p-4 ${className}`}>
      <div className={`h-3 w-24 bg-zinc-800 rounded mb-4 ${shimmer}`} />
      <div className={`h-8 w-32 bg-zinc-800 rounded mb-3 ${shimmer}`} />
      <div className={`h-2 w-20 bg-zinc-800/60 rounded ${shimmer}`} />
    </div>
  );
}

export function ChartSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-[#1F2937] bg-[#151922] p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`h-3 w-28 bg-zinc-800 rounded ${shimmer}`} />
        <div className={`h-5 w-16 bg-zinc-800 rounded ${shimmer}`} />
      </div>
      <div className="flex items-center justify-between mb-3 gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`h-4 w-8 bg-zinc-800/50 rounded ${shimmer}`} />
        ))}
      </div>
      <div className={`h-48 bg-zinc-800/30 rounded ${shimmer}`} />
    </div>
  );
}

export function ControlBarSkeleton() {
  return (
    <div className="rounded-xl border border-[#1F2937] bg-[#151922] px-4 py-3">
      <div className="flex items-center gap-4">
        <div className={`flex-1 max-w-md h-9 bg-zinc-800 rounded-lg ${shimmer}`} />
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`h-4 w-16 bg-zinc-800/60 rounded ${shimmer}`} />
          ))}
        </div>
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`h-8 w-20 bg-zinc-800/40 rounded-lg ${shimmer}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div className="rounded-xl border border-[#1F2937] bg-[#151922] p-4">
      <div className={`h-3 w-20 bg-zinc-800 rounded mb-4 ${shimmer}`} />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-3.5 h-3.5 bg-zinc-800/60 rounded-full ${shimmer}`} />
            <div className={`flex-1 h-3 bg-zinc-800/40 rounded ${shimmer}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
