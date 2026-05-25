'use client';

import { type ReactNode, useState, useRef, useCallback, memo } from 'react';

interface SmartTooltipProps {
  content: string;
  danger?: string;
  children: ReactNode;
}

function SmartTooltipInner({ content, danger, children }: SmartTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 400);
  }, []);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <div className="bg-[#1a1f2e] border border-[#2a3040] rounded-lg px-3 py-2 shadow-xl max-w-[240px] min-w-[160px]">
            <p className="text-[11px] text-zinc-300 leading-relaxed">{content}</p>
            {danger && (
              <p className="text-[10px] text-amber-400/90 mt-1.5 pt-1.5 border-t border-[#2a3040] leading-relaxed">
                {danger}
              </p>
            )}
          </div>
          <div className="w-2 h-2 bg-[#1a1f2e] border-r border-b border-[#2a3040] rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1" />
        </div>
      )}
    </span>
  );
}

export const SmartTooltip = memo(SmartTooltipInner);
