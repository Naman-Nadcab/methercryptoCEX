'use client';

import Link from 'next/link';
import { type LucideIcon, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  /** Icon to show (default: Inbox) */
  icon?: LucideIcon;
  /** Short title, e.g. "No orders yet" */
  title: string;
  /** Optional longer description */
  description?: string;
  /** Optional CTA: { label, href } */
  action?: { label: string; href: string };
  /** Optional CTA as button (e.g. "Place first order") */
  actionLabel?: string;
  actionHref?: string;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  actionLabel,
  actionHref,
  className = '',
}: EmptyStateProps) {
  const href = action?.href ?? actionHref;
  const label = action?.label ?? actionLabel;

  return (
    <div
      className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}
      role="status"
      aria-label={title}
    >
      <div className="w-14 h-14 rounded-full bg-accent flex items-center justify-center mb-4 text-muted-foreground">
        <Icon className="w-7 h-7" aria-hidden />
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          {description}
        </p>
      )}
      {href && label && (
        <Link
          href={href}
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary hover:bg-primary/85 text-primary-foreground text-sm font-medium transition-colors"
        >
          {label}
        </Link>
      )}
    </div>
  );
}
