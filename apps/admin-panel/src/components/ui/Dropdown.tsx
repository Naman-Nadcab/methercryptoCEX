'use client';

import * as React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  DropdownMenu                                                       */
/* ------------------------------------------------------------------ */

export interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  onSelect: (id: string) => void;
  align?: 'left' | 'right';
  className?: string;
}

export function DropdownMenu({ trigger, items, onSelect, align = 'right', className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback((item: DropdownItem) => {
    if (item.disabled) return;
    onSelect(item.id);
    setOpen(false);
  }, [onSelect]);

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <div onClick={() => setOpen((s) => !s)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen((s) => !s)}>
        {trigger}
      </div>

      {open && (
        <div
          className={cn(
            'absolute top-full mt-1 z-30 min-w-[180px] rounded-ds-md border border-admin-border bg-admin-card py-1 shadow-dropdown animate-fade-in',
            align === 'right' ? 'right-0' : 'left-0'
          )}
          role="menu"
        >
          {items.map((item) => {
            if (item.divider) {
              return <div key={item.id} className="my-1 border-t border-admin-border" role="separator" />;
            }
            return (
              <button
                key={item.id}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleSelect(item)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                  item.disabled && 'opacity-50 cursor-not-allowed',
                  item.danger
                    ? 'text-admin-danger hover:bg-red-50'
                    : 'text-admin-text hover:bg-admin-card/5'
                )}
              >
                {item.icon && <span className="shrink-0 w-4 h-4">{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Select — styled native select replacement                         */
/* ------------------------------------------------------------------ */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function Select({ options, value, onChange, placeholder, label, size = 'md', className }: SelectProps) {
  return (
    <div className={cn('w-full', className)}>
      {label && <label className="block mb-1.5 text-sm font-medium text-admin-text">{label}</label>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full appearance-none rounded-ds-md border border-admin-border bg-admin-card pr-9 text-admin-text',
            'focus:outline-none focus:ring-2 focus:ring-admin-primary focus:border-transparent transition-colors duration-200',
            size === 'sm' ? 'h-8 pl-3 text-xs' : 'h-10 pl-3 text-sm'
          )}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-muted pointer-events-none" />
      </div>
    </div>
  );
}
