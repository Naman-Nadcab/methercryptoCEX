'use client';

import { useEffect, useState, useRef } from 'react';
import { Clock } from 'lucide-react';

type Props = {
  expiresAtIso: string | null | undefined;
  active: boolean;
  onExpire?: () => void;
};

export function P2PTimer({ expiresAtIso, active, onExpire }: Props) {
  const [leftSec, setLeftSec] = useState<number | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
  }, [expiresAtIso, active]);

  useEffect(() => {
    if (!active || !expiresAtIso) {
      setLeftSec(null);
      return;
    }
    const end = new Date(expiresAtIso).getTime();
    const tick = () => {
      const diff = Math.floor((end - Date.now()) / 1000);
      if (diff <= 0) {
        setLeftSec(0);
        if (!fired.current) {
          fired.current = true;
          onExpire?.();
        }
        return;
      }
      setLeftSec(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAtIso, active, onExpire]);

  if (!active || !expiresAtIso) return null;

  const m = leftSec == null ? 0 : Math.floor(leftSec / 60);
  const s = leftSec == null ? 0 : leftSec % 60;
  const urgent = leftSec != null && leftSec < 300;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        urgent
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200'
          : 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200'
      }`}
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span className="font-medium">Payment window</span>
      <span className="ml-auto font-mono tabular-nums">
        {leftSec == null ? '—' : `${m}:${s.toString().padStart(2, '0')}`}
      </span>
    </div>
  );
}
