'use client';

import { Trophy, Medal, Award } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

export interface LeaderboardEntry {
  rank: number;
  user: string;
  totalEarnings: number;
}

export interface ReferralLeaderboardProps {
  entries?: LeaderboardEntry[];
  loading?: boolean;
}

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="w-5 h-5 text-amber-500" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />;
  if (rank === 3) return <Award className="w-5 h-5 text-amber-700" />;
  return (
    <span className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-xs font-semibold text-muted-foreground">
      {rank}
    </span>
  );
}

export function ReferralLeaderboard({ entries = [], loading = false }: ReferralLeaderboardProps) {
  const list = entries.length > 0 ? entries : [];

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden card-bybit">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Referral Leaderboard</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Top referrers by total earnings</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-3 px-4 font-medium w-16">Rank</th>
              <th className="py-3 px-4 font-medium">User</th>
              <th className="py-3 px-4 font-medium text-right">Total Earnings</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-3 px-4"><Skeleton className="h-6 w-6 rounded" /></td>
                  <td className="py-3 px-4"><Skeleton className="h-4 w-24" /></td>
                  <td className="py-3 px-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                </tr>
              ))
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 px-4 text-center text-muted-foreground text-sm">
                  No leaderboard data yet. Start referring to climb the ranks!
                </td>
              </tr>
            ) : (
              list.map((row) => (
                <tr
                  key={row.rank}
                  className="border-b border-border last:border-0 hover:bg-gray-50 dark:hover:bg-card/[0.04] transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <RankIcon rank={row.rank} />
                    </div>
                  </td>
                  <td className="py-3 px-4 font-medium text-foreground">{row.user}</td>
                  <td className="py-3 px-4 text-right font-semibold text-foreground tabular-nums">
                    ${row.totalEarnings.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
