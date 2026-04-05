'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { Users, Circle } from 'lucide-react';

interface SimulatedAdmin {
  name: string;
  page: string;
  avatarColor: string;
}

const SIMULATED_ADMINS: SimulatedAdmin[] = [
  { name: 'Joshua', page: 'Dashboard', avatarColor: '#3B82F6' },
  { name: 'Admin2', page: 'Withdrawals', avatarColor: '#8B5CF6' },
  { name: 'Sarah', page: 'Risk Control', avatarColor: '#EC4899' },
  { name: 'DevOps', page: 'System Health', avatarColor: '#10B981' },
];

function pickActiveAdmins(): SimulatedAdmin[] {
  const count = 2 + Math.floor(Math.random() * 2);
  const shuffled = [...SIMULATED_ADMINS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function ActiveAdminsIndicatorInner() {
  const [admins, setAdmins] = useState<SimulatedAdmin[]>([]);

  useEffect(() => {
    setAdmins(pickActiveAdmins());
    const id = setInterval(() => setAdmins(pickActiveAdmins()), 30_000);
    return () => clearInterval(id);
  }, []);

  const display = useMemo(() => admins.slice(0, 3), [admins]);

  if (display.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1F2937] bg-[#151922]">
      <Users className="w-3.5 h-3.5 text-zinc-500" />
      <div className="flex items-center -space-x-2">
        {display.map((admin) => (
          <div
            key={admin.name}
            className="w-6 h-6 rounded-full border-2 border-[#151922] flex items-center justify-center text-[9px] font-bold text-white"
            style={{ backgroundColor: admin.avatarColor }}
            title={`${admin.name} — ${admin.page}`}
          >
            {admin.name.charAt(0)}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        {display.map((admin) => (
          <div key={admin.name} className="flex items-center gap-1.5 text-[10px] leading-tight">
            <Circle className="w-1.5 h-1.5 fill-emerald-400 text-emerald-400 shrink-0" />
            <span className="text-zinc-300 font-medium truncate">{admin.name}</span>
            <span className="text-zinc-600 truncate">({admin.page})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ActiveAdminsIndicator = memo(ActiveAdminsIndicatorInner);
