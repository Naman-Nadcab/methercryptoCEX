'use client';

import * as React from 'react';
import { useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  title?: string;
  description?: string;
  /** Hide the default close (X) button */
  hideClose?: boolean;
  /** Prevent closing via overlay click or Escape */
  persistent?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Modal({
  open,
  onClose,
  children,
  size = 'md',
  title,
  description,
  hideClose,
  persistent,
  className,
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) onClose();
    },
    [onClose, persistent]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in"
        onClick={persistent ? undefined : onClose}
        aria-hidden
      />

      {/* Centered container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
        <div
          ref={contentRef}
          className={cn(
            'w-full rounded-ds-lg bg-admin-card shadow-modal animate-scale-in',
            SIZE_CLASSES[size],
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {(title || !hideClose) && (
            <div className="flex items-start justify-between px-6 pt-5 pb-0">
              <div className="min-w-0 flex-1">
                {title && <h2 className="text-lg font-semibold text-admin-text">{title}</h2>}
                {description && <p className="mt-1 text-sm text-admin-muted">{description}</p>}
              </div>
              {!hideClose && (
                <button
                  onClick={onClose}
                  className="ml-3 shrink-0 rounded-md p-1.5 text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Body */}
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  ModalFooter                                                        */
/* ------------------------------------------------------------------ */

export function ModalFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t border-admin-border px-6 py-4', className)}>
      {children}
    </div>
  );
}
