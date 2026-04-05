import * as React from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', label, error, hint, iconLeft, iconRight, id, ...props }, ref) => {
    const inputId = id || (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
    const hasError = !!error;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block mb-1.5 text-sm font-medium text-admin-text">
            {label}
          </label>
        )}
        <div className="relative">
          {iconLeft && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-admin-muted pointer-events-none">
              {iconLeft}
            </div>
          )}
          <input
            id={inputId}
            type={type}
            ref={ref}
            className={cn(
              'flex h-10 w-full rounded-ds-md border bg-admin-surface px-3 py-2 text-sm text-admin-text',
              'placeholder:text-admin-muted/60',
              'focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-150',
              'disabled:cursor-not-allowed disabled:opacity-40',
              hasError
                ? 'border-admin-danger focus:ring-admin-danger/30'
                : 'border-admin-border focus:ring-admin-primary/50',
              iconLeft && 'pl-10',
              iconRight && 'pr-10',
              className
            )}
            aria-invalid={hasError || undefined}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
          {iconRight && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-admin-muted">
              {iconRight}
            </div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="mt-1 text-xs text-admin-danger" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="mt-1 text-xs text-admin-muted">
            {hint}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id || (label ? `textarea-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
    const hasError = !!error;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block mb-1.5 text-sm font-medium text-admin-text">
            {label}
          </label>
        )}
        <textarea
          id={inputId}
          ref={ref}
          className={cn(
            'flex min-h-[80px] w-full rounded-ds-md border bg-admin-surface px-3 py-2 text-sm text-admin-text',
            'placeholder:text-admin-muted/60',
            'focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-150',
            'disabled:cursor-not-allowed disabled:opacity-40',
            hasError
              ? 'border-admin-danger focus:ring-admin-danger/30'
              : 'border-admin-border focus:ring-admin-primary/50',
            className
          )}
          aria-invalid={hasError || undefined}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-admin-danger" role="alert">{error}</p>
        )}
        {!error && hint && (
          <p className="mt-1 text-xs text-admin-muted">{hint}</p>
        )}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Input, Textarea };
